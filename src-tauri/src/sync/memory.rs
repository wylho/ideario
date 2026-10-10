//! Drive em memória para os testes: vários "aparelhos" compartilham o mesmo, como a mesma conta Google.
//! Imita o que importa do Drive: ids próprios, versão que muda a cada envio, lista de mudanças com marca, e
//! falhas de rede quando o teste pede.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard};

use super::{Change, NewFile, Props, RemoteFile, Remote, SResult, SyncError};

#[derive(Default)]
struct Inner {
    files: BTreeMap<String, (RemoteFile, Vec<u8>)>,
    /// Arquivos na ordem em que mudaram (a "lista de mudanças").
    log: Vec<String>,
    next: u64,
    clock: i64,
    calls: usize,
    /// Falha (sem rede) na chamada de número N, contando todas.
    fail_at: Option<usize>,
    /// Quantos envios (criar e atualizar) e downloads aconteceram.
    uploads: usize,
    downloads: usize,
}

#[derive(Clone, Default)]
pub(crate) struct MemoryDrive(Arc<Mutex<Inner>>);

impl MemoryDrive {
    fn inner(&self) -> MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A próxima chamada (de qualquer aparelho) depois de `n` chamadas daqui para frente falha.
    pub fn fail_after(&self, n: usize) {
        let mut i = self.inner();
        i.fail_at = Some(i.calls + n + 1);
    }

    pub fn files(&self) -> Vec<RemoteFile> {
        self.inner().files.values().map(|(f, _)| f.clone()).collect()
    }

    /// (envios, downloads) até agora.
    pub fn traffic(&self) -> (usize, usize) {
        let i = self.inner();
        (i.uploads, i.downloads)
    }

    /// Escreve direto no Drive, como outro aparelho faria (para simular corridas).
    pub fn overwrite(&self, id: &str, bytes: &[u8]) {
        let mut i = self.inner();
        i.clock += 1000;
        let clock = i.clock;
        if let Some((f, b)) = i.files.get_mut(id) {
            f.rev = (f.rev.parse::<u64>().unwrap_or(0) + 1).to_string();
            f.modified = clock;
            *b = bytes.to_vec();
        }
        i.log.push(id.to_string());
    }

    fn call(&self) -> SResult<MutexGuard<'_, Inner>> {
        let mut i = self.inner();
        i.calls += 1;
        if i.fail_at == Some(i.calls) {
            i.fail_at = None;
            return Err(SyncError::Offline("rede caiu (teste)".into()));
        }
        i.clock += 1000;
        Ok(i)
    }
}

impl Remote for MemoryDrive {
    fn start_token(&mut self) -> SResult<String> {
        Ok(self.call()?.log.len().to_string())
    }

    fn list_all(&mut self) -> SResult<Vec<RemoteFile>> {
        Ok(self.call()?.files.values().map(|(f, _)| f.clone()).collect())
    }

    fn changes(&mut self, token: &str) -> SResult<(Vec<Change>, String)> {
        let i = self.call()?;
        let from: usize = token.parse().map_err(|_| SyncError::Other("marca inválida".into()))?;
        // Como o Drive: cada arquivo aparece uma vez, com o estado atual.
        let mut seen = Vec::<&String>::new();
        for id in i.log.iter().skip(from) {
            if !seen.contains(&id) {
                seen.push(id);
            }
        }
        let changes = seen
            .into_iter()
            .map(|id| match i.files.get(id) {
                Some((f, _)) => Change::Upsert(f.clone()),
                None => Change::Removed(id.clone()),
            })
            .collect();
        Ok((changes, i.log.len().to_string()))
    }

    fn download(&mut self, id: &str) -> SResult<Vec<u8>> {
        let mut i = self.call()?;
        i.downloads += 1;
        i.files.get(id).map(|(_, b)| b.clone()).ok_or(SyncError::NotFound)
    }

    fn create(&mut self, file: &NewFile) -> SResult<RemoteFile> {
        let mut i = self.call()?;
        i.next += 1;
        i.uploads += 1;
        // Ids sem ordem de criação, como os do Drive.
        let id = format!("{:x}", sha2::Digest::finalize(<sha2::Sha256 as sha2::Digest>::new_with_prefix(i.next.to_le_bytes())))[..12].to_string();
        let f = RemoteFile { id: id.clone(), rev: "1".into(), modified: i.clock, props: file.props.clone(), description: file.description.clone() };
        i.files.insert(id.clone(), (f.clone(), file.bytes.to_vec()));
        i.log.push(id);
        Ok(f)
    }

    fn update(&mut self, id: &str, props: &Props, bytes: &[u8]) -> SResult<RemoteFile> {
        let mut i = self.call()?;
        i.uploads += 1;
        let clock = i.clock;
        let Some((f, b)) = i.files.get_mut(id) else { return Err(SyncError::NotFound) };
        f.rev = (f.rev.parse::<u64>().unwrap_or(0) + 1).to_string();
        f.modified = clock;
        f.props.extend(props.clone());
        *b = bytes.to_vec();
        let f = f.clone();
        i.log.push(id.to_string());
        Ok(f)
    }

    fn delete(&mut self, id: &str) -> SResult<()> {
        let mut i = self.call()?;
        i.files.remove(id).ok_or(SyncError::NotFound)?;
        i.log.push(id.to_string());
        Ok(())
    }
}
