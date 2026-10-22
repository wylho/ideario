//! Lembretes que avisam (Fase 4): o núcleo confere a cada poucos segundos o que venceu, avisa uma vez por aparelho
//! (`notes.notified_at`) e, se o lembrete se repete, já agenda a próxima vez. Lembretes vencidos com o computador
//! desligado ou o app fechado avisam na próxima abertura, marcados como atrasados.
//!
//! Aqui fica a regra (pura, testável). Quem mostra a notificação do sistema é o `Notifier` (lib.rs).

use chrono::{Datelike, Days, Local, Months, NaiveDateTime, TimeZone};
use serde::Serialize;
use serde_json::{Map, Value};

use crate::store::{DueReminder, Millis, Result, Store};

/// Mais que isso depois da hora marcada = atrasado (o app estava fechado ou o computador desligado).
const LATE_AFTER: Millis = 5 * 60 * 1000;
/// Avisos individuais no máximo; o resto vira "e mais N".
const MAX_ALERTS: usize = 3;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    pub id: String,
    pub title: String,
    pub at: Millis,
    pub late: bool,
    /// Lembrete que se repete (já foi para a próxima vez: "Concluir" não se aplica).
    pub repeats: bool,
}

/// Uma notificação do sistema (já com o texto).
#[derive(Debug, Clone, PartialEq)]
pub struct Notice {
    pub title: String,
    pub body: String,
    /// Nota que "Abrir" abre (None no aviso de resumo).
    pub note: Option<String>,
    pub repeats: bool,
}

/// Quem mostra as notificações (a do sistema no app; uma lista nos testes).
pub trait Notifier {
    fn show(&self, notice: &Notice);
}


/// O que venceu até `now` e ainda não foi avisado neste aparelho. Marca como avisado e reagenda os que se repetem.
pub fn take_due<Tz: TimeZone>(store: &Store, now: Millis, tz: &Tz) -> Result<Vec<Alert>> {
    let mut out = Vec::new();
    for DueReminder { id, title, at, repeat, snoozed } in store.due_reminders(now)? {
        if snoozed {
            // Volta de um adiamento: avisa uma vez; a série continua no horário dela.
            store.set_snooze(&id, None)?;
            out.push(Alert { id, title, at, late: now - at > LATE_AFTER, repeats: repeat.is_some() });
            continue;
        }
        store.mark_notified(&id, at)?;
        if let Some(next) = repeat.as_deref().and_then(|r| next_occurrence(at, r, now, tz)) {
            // A próxima vez entra no lugar (como no Keep); concluir não faz sentido num lembrete que se repete.
            let mut patch = Map::new();
            patch.insert("reminderAt".into(), Value::from(next));
            store.reschedule(&id, &patch)?;
        }
        out.push(Alert { id, title, at, late: now - at > LATE_AFTER, repeats: repeat.is_some() });
    }
    Ok(out)
}

/// Adiar: o que se repete avisa de novo em `until` sem mudar a série; o que é de uma vez passa para `until`.
/// Nenhum dos dois conta como edição da nota.
pub fn snooze(store: &Store, id: &str, until: Millis) -> Result<()> {
    match store.reminder_of(id)? {
        Some((_, Some(_))) => store.set_snooze(id, Some(until)),
        Some((_, None)) => {
            let mut patch = Map::new();
            patch.insert("reminderAt".into(), Value::from(until));
            patch.insert("reminderDone".into(), Value::Bool(false));
            store.reschedule(id, &patch).map(|_| ())
        }
        None => Ok(()),
    }
}

/// Concluir: o que é de uma vez fica concluído; o que se repete pula para a próxima vez (a série continua).
pub fn complete<Tz: TimeZone>(store: &Store, id: &str, now: Millis, tz: &Tz) -> Result<()> {
    let Some((at, repeat)) = store.reminder_of(id)? else { return Ok(()) };
    if repeat.is_some() {
        store.set_snooze(id, None)?;
    }
    let mut card = CardStatus { reminder_at: Some(at), reminder_repeat: repeat, ..Default::default() };
    card.complete(now, tz);
    write_status(store, id, &card)
}

/// Grava o que a regra do Atrio decidiu (nada disso conta como edição da nota).
fn write_status(store: &Store, id: &str, card: &CardStatus) -> Result<()> {
    let mut patch = Map::new();
    if let Some(at) = card.reminder_at {
        patch.insert("reminderAt".into(), Value::from(at));
    } else {
        patch.insert("statusOn".into(), Value::Bool(card.status_on));
    }
    patch.insert("reminderDone".into(), Value::Bool(card.reminder_done));
    patch.insert("reminderDoing".into(), Value::Bool(card.reminder_doing));
    store.reschedule(id, &patch).map(|_| ())
}

// Status de três cores, a regra do lembrete que se repete e a próxima vez: as do Atrio, as mesmas do Nodo.
pub use atrio::card::{next_occurrence, Status};
use atrio::card::CardStatus;

/// Muda o status pela regra do Atrio: com lembrete, verde é concluir (o que se repete pula para a próxima vez e
/// volta ao vermelho); sem lembrete, a nota passa a ter status (`statusOn`), como pelo menu da nota.
pub fn set_status<Tz: TimeZone>(store: &Store, id: &str, status: Status, now: Millis, tz: &Tz) -> Result<()> {
    let reminder = store.reminder_of(id)?;
    if reminder.as_ref().is_some_and(|(_, r)| r.is_some()) && status == Status::Done {
        return complete(store, id, now, tz);
    }
    let mut card = CardStatus::default();
    if let Some((at, repeat)) = reminder {
        card.reminder_at = Some(at);
        card.reminder_repeat = repeat;
    }
    card.set_status(status, now, tz);
    write_status(store, id, &card)
}

/// Tira o status posto pelo menu. Nota com lembrete continua com status (ele vem do lembrete).
pub fn clear_status(store: &Store, id: &str) -> Result<()> {
    let mut patch = Map::new();
    patch.insert("statusOn".into(), Value::Bool(false));
    if store.reminder_of(id)?.is_none() {
        let mut card = CardStatus { status_on: true, ..Default::default() };
        card.clear_status();
        patch.insert("reminderDone".into(), Value::Bool(card.reminder_done));
        patch.insert("reminderDoing".into(), Value::Bool(card.reminder_doing));
    }
    store.reschedule(id, &patch).map(|_| ())
}

/// Texto das notificações: até 3 avisos, um por nota; passou disso, os 2 primeiros e um resumo do resto.
pub fn notices(alerts: &[Alert]) -> Vec<Notice> {
    let one = |a: &Alert| Notice {
        title: if a.title.is_empty() { "Lembrete".into() } else { a.title.clone() },
        body: if a.late { format!("Lembrete atrasado · era para {}", when(a.at)) } else { "Lembrete".into() },
        note: Some(a.id.clone()),
        repeats: a.repeats,
    };
    if alerts.len() <= MAX_ALERTS {
        return alerts.iter().map(one).collect();
    }
    let mut out: Vec<Notice> = alerts.iter().take(MAX_ALERTS - 1).map(one).collect();
    let rest = alerts.len() - (MAX_ALERTS - 1);
    out.push(Notice {
        title: format!("Mais {rest} lembretes"),
        body: "Abra o Ideario para ver todos em Lembretes.".into(),
        note: None,
        repeats: false,
    });
    out
}

/// "hoje, 18:00", "ontem, 09:30", "12/10, 09:00" (hora local).
fn when(at: Millis) -> String {
    let Some(t) = Local.timestamp_millis_opt(at).single() else { return String::new() };
    let today = Local::now().date_naive();
    let day = t.date_naive();
    let prefix = if day == today {
        "hoje".to_string()
    } else if today.pred_opt() == Some(day) {
        "ontem".to_string()
    } else {
        format!("{:02}/{:02}", day.day(), day.month())
    };
    format!("{prefix}, {}", t.format("%H:%M"))
}

#[cfg(any(target_os = "android", test))]
/// Uma notificação agendada no sistema (Android: o app fechado não confere lembretes, quem dispara é o sistema).
#[derive(Debug, Clone, PartialEq)]
pub struct Planned {
    /// Número da notificação: o mesmo para a mesma nota no mesmo horário (reagendar não duplica).
    pub key: i32,
    pub note: String,
    pub title: String,
    pub at: Millis,
}

#[cfg(any(target_os = "android", test))]
/// Quanto à frente os lembretes que se repetem são expandidos, e o máximo de alarmes (o Android limita por app).
pub const PLAN_HORIZON: Millis = 14 * 86_400_000;
#[cfg(any(target_os = "android", test))]
pub const PLAN_MAX: usize = 200;

#[cfg(any(target_os = "android", test))]
/// O que agendar no sistema a partir de `now`: cada lembrete por vir e, nos que se repetem, as próximas vezes até
/// `PLAN_HORIZON` (o app aberto reagenda o resto). Em ordem de horário, no máximo `PLAN_MAX`.
pub fn plan<Tz: TimeZone>(store: &Store, now: Millis, tz: &Tz) -> Result<Vec<Planned>> {
    let mut out = Vec::new();
    for DueReminder { id, title, at, repeat, snoozed } in store.upcoming_reminders(now)? {
        let mut when = Some(at);
        while let Some(t) = when.filter(|t| *t <= now + PLAN_HORIZON) {
            out.push(Planned { key: plan_key(&id, t), note: id.clone(), title: title.clone(), at: t });
            // A volta de um adiamento é uma vez só; a série segue pela própria linha.
            when = if snoozed { None } else { repeat.as_deref().and_then(|r| next_occurrence(at, r, t, tz)) };
        }
    }
    out.sort_by_key(|p| p.at);
    out.truncate(PLAN_MAX);
    Ok(out)
}

#[cfg(any(target_os = "android", test))]
/// Onde fica, só neste aparelho, a nota de cada número de notificação agendado.
const KEYS_STATE: &str = "notification_keys";

#[cfg(any(target_os = "android", test))]
/// Por quanto tempo um número de notificação ainda leva à nota (tocar numa notificação antiga).
const KEYS_KEEP: Millis = 30 * 86_400_000;

#[cfg(any(target_os = "android", test))]
/// Guarda a nota de cada número agendado, junto com os de antes (a notificação já disparada continua na bandeja, e
/// tocar nela tem de achar a nota mesmo depois de a agenda mudar). Esquece o que passou há mais de `KEYS_KEEP`.
pub fn remember_keys(store: &Store, plan: &[Planned], now: Millis) -> Result<()> {
    let mut keys: Map<String, Value> =
        store.sync_value(KEYS_STATE)?.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default();
    for p in plan {
        keys.insert(p.key.to_string(), serde_json::json!([p.note, p.at]));
    }
    keys.retain(|_, v| v.get(1).and_then(Value::as_i64).is_some_and(|at| at >= now - KEYS_KEEP));
    store.set_sync_value(KEYS_STATE, Some(&Value::Object(keys).to_string()))
}

#[cfg(any(target_os = "android", test))]
/// A nota de uma notificação tocada, pelo número dela (o plugin de notificação do Android só devolve o número).
pub fn note_for_key(store: &Store, key: i32) -> Result<Option<String>> {
    let keys: Map<String, Value> =
        store.sync_value(KEYS_STATE)?.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default();
    Ok(keys.get(&key.to_string()).and_then(|v| v.get(0)).and_then(Value::as_str).map(str::to_string))
}

#[cfg(any(target_os = "android", test))]
fn plan_key(note: &str, at: Millis) -> i32 {
    use sha2::{Digest, Sha256};
    let h = Sha256::digest(format!("{note}@{at}").as_bytes());
    i32::from_be_bytes([h[0] & 0x7f, h[1], h[2], h[3]])
}

/// Mostra as notificações e devolve os avisos (para a janela, se estiver aberta, mostrar o aviso dentro do app).
pub fn tick(store: &Store, now: Millis, notifier: &dyn Notifier) -> Result<Vec<Alert>> {
    let alerts = take_due(store, now, &Local)?;
    for n in notices(&alerts) {
        notifier.show(&n);
    }
    Ok(alerts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{Filter, NoteInput};
    use chrono::FixedOffset;
    use serde_json::json;
    use std::cell::RefCell;

    const HOUR: Millis = 3_600_000;

    fn sp() -> FixedOffset {
        FixedOffset::west_opt(3 * 3600).unwrap() // São Paulo, sem horário de verão
    }

    fn at(tz: &impl TimeZone, y: i32, m: u32, d: u32, h: u32) -> Millis {
        tz.with_ymd_and_hms(y, m, d, h, 0, 0).single().unwrap().timestamp_millis()
    }

    #[test]
    fn daily_weekly_keep_the_local_time() {
        let tz = sp();
        let first = at(&tz, 2026, 10, 9, 9);
        assert_eq!(next_occurrence(first, "day", first, &tz), Some(at(&tz, 2026, 10, 10, 9)));
        assert_eq!(next_occurrence(first, "week", first, &tz), Some(at(&tz, 2026, 10, 16, 9)));
        // perdido por vários dias (app fechado): pula para a próxima no futuro, não para ontem
        let now = at(&tz, 2026, 10, 20, 12);
        assert_eq!(next_occurrence(first, "day", now, &tz), Some(at(&tz, 2026, 10, 21, 9)));
    }

    #[test]
    fn monthly_from_the_31st_does_not_drift() {
        let tz = sp();
        let jan31 = at(&tz, 2026, 1, 31, 8);
        let feb = next_occurrence(jan31, "month", jan31, &tz).unwrap();
        assert_eq!(feb, at(&tz, 2026, 2, 28, 8));
        // depois de fevereiro, volta ao 31 (conta da data original)
        assert_eq!(next_occurrence(jan31, "month", feb, &tz), Some(at(&tz, 2026, 3, 31, 8)));
        // anual em 29/fev
        let leap = at(&tz, 2028, 2, 29, 8);
        assert_eq!(next_occurrence(leap, "year", leap, &tz), Some(at(&tz, 2029, 2, 28, 8)));
    }

    #[test]
    fn daylight_saving_keeps_the_wall_clock() {
        // Nova York: horário de verão começa em 8/mar/2026; o lembrete das 9h continua às 9h locais.
        let ny = |y, m, d, h, off: i32| FixedOffset::west_opt(off * 3600).unwrap().with_ymd_and_hms(y, m, d, h, 0, 0).single().unwrap().timestamp_millis();
        // fuso que muda: um TimeZone de teste simples (antes de 8/mar: −5; depois: −4)
        #[derive(Clone)]
        struct Ny;
        impl TimeZone for Ny {
            type Offset = FixedOffset;
            fn from_offset(_: &FixedOffset) -> Ny {
                Ny
            }
            fn offset_from_local_date(&self, d: &chrono::NaiveDate) -> chrono::LocalResult<FixedOffset> {
                chrono::LocalResult::Single(Self::off(*d))
            }
            fn offset_from_local_datetime(&self, l: &NaiveDateTime) -> chrono::LocalResult<FixedOffset> {
                chrono::LocalResult::Single(Self::off(l.date()))
            }
            fn offset_from_utc_date(&self, d: &chrono::NaiveDate) -> FixedOffset {
                Self::off(*d)
            }
            fn offset_from_utc_datetime(&self, u: &NaiveDateTime) -> FixedOffset {
                Self::off(u.date())
            }
        }
        impl Ny {
            fn off(d: chrono::NaiveDate) -> FixedOffset {
                let dst = d >= chrono::NaiveDate::from_ymd_opt(2026, 3, 8).unwrap();
                FixedOffset::west_opt(if dst { 4 } else { 5 } * 3600).unwrap()
            }
        }
        let before = ny(2026, 3, 7, 9, 5);
        assert_eq!(next_occurrence(before, "day", before, &Ny), Some(ny(2026, 3, 8, 9, 4)));
        assert_eq!(next_occurrence(before, "day", before, &Ny).unwrap() - before, 23 * HOUR, "um dia com 23 h");
    }

    #[test]
    fn unknown_repeat_has_no_next_time() {
        assert_eq!(next_occurrence(0, "hour", 10, &sp()), None);
    }

    struct Recorder(RefCell<Vec<Notice>>);
    impl Notifier for Recorder {
        fn show(&self, n: &Notice) {
            self.0.borrow_mut().push(n.clone());
        }
    }

    fn note(id: &str, title: &str, reminder: Option<Millis>, repeat: Option<&str>) -> NoteInput {
        NoteInput {
            id: id.into(),
            title: title.into(),
            body: json!({"type":"doc","content":[{"type":"paragraph"}]}),
            category_id: None,
            color: "none".into(),
            pinned: false,
            archived: false,
            trashed_at: None,
            reminder_at: reminder,
            reminder_done: false,
            reminder_doing: false,
            status_on: false,
            reminder_repeat: repeat.map(str::to_string),
            emoji: None,
            tags: vec![],
        }
    }

    #[test]
    fn each_reminder_notifies_once_and_late_ones_say_so() {
        let s = Store::memory();
        let now = 1_791_600_000_000;
        s.save_note(&note("a", "Remédio", Some(now - 30 * 1000), None)).unwrap();
        s.save_note(&note("b", "Reunião", Some(now - 2 * HOUR), None)).unwrap();
        s.save_note(&note("c", "Depois", Some(now + HOUR), None)).unwrap();
        let mut done = note("d", "Feito", Some(now - HOUR), None);
        done.reminder_done = true;
        s.save_note(&done).unwrap();
        let mut trashed = note("e", "Lixo", Some(now - HOUR), None);
        trashed.trashed_at = Some(now);
        s.save_note(&trashed).unwrap();

        let r = Recorder(RefCell::new(vec![]));
        let alerts = tick(&s, now, &r).unwrap();
        let mut got: Vec<(&str, bool)> = alerts.iter().map(|a| (a.id.as_str(), a.late)).collect();
        got.sort();
        assert_eq!(got, vec![("a", false), ("b", true)], "só os vencidos, ativos e não concluídos");
        assert_eq!(r.0.borrow().len(), 2);
        assert!(r.0.borrow().iter().any(|n| n.title == "Reunião" && n.body.starts_with("Lembrete atrasado")));
        // de novo: nada (já avisou neste aparelho)
        assert!(tick(&s, now + 1000, &r).unwrap().is_empty());
        // adiado: avisa de novo na hora nova
        let mut patch = Map::new();
        patch.insert("reminderAt".into(), json!(now + 10 * 60 * 1000));
        s.update_note("a", &patch).unwrap();
        assert!(tick(&s, now + 5 * 60 * 1000, &r).unwrap().is_empty());
        assert_eq!(tick(&s, now + 11 * 60 * 1000, &r).unwrap().len(), 1);
    }

    #[test]
    fn plan_lists_what_the_system_must_fire_while_the_app_is_closed() {
        let s = Store::memory();
        let tz = sp();
        let now = at(&tz, 2026, 10, 9, 12);
        s.save_note(&note("a", "Dentista", Some(at(&tz, 2026, 10, 10, 9)), None)).unwrap();
        s.save_note(&note("b", "Plantas", Some(at(&tz, 2026, 10, 9, 18)), Some("day"))).unwrap();
        s.save_note(&note("c", "Passou", Some(now - HOUR), None)).unwrap();
        let mut done = note("d", "Feito", Some(now + HOUR), None);
        done.reminder_done = true;
        s.save_note(&done).unwrap();
        let mut trashed = note("e", "Lixo", Some(now + HOUR), None);
        trashed.trashed_at = Some(now);
        s.save_note(&trashed).unwrap();

        let p = plan(&s, now, &tz).unwrap();
        // só o que está por vir, ativo e não concluído; o diário, expandido pelos 14 dias à frente
        assert!(p.iter().all(|x| x.note == "a" || x.note == "b"));
        assert_eq!(p.iter().filter(|x| x.note == "a").count(), 1);
        let plants: Vec<Millis> = p.iter().filter(|x| x.note == "b").map(|x| x.at).collect();
        assert_eq!(plants.len(), 14);
        assert_eq!(plants[0], at(&tz, 2026, 10, 9, 18));
        assert_eq!(plants[1], at(&tz, 2026, 10, 10, 18));
        assert!(plants.iter().all(|t| *t <= now + PLAN_HORIZON));
        // em ordem de horário; o mesmo horário da mesma nota tem sempre o mesmo número (reagendar não duplica)
        assert!(p.windows(2).all(|w| w[0].at <= w[1].at));
        assert_eq!(plan(&s, now, &tz).unwrap(), p);
        let keys: std::collections::HashSet<i32> = p.iter().map(|x| x.key).collect();
        assert_eq!(keys.len(), p.len());
        assert!(p.iter().all(|x| x.key >= 0));
    }

    #[test]
    fn a_tapped_notification_finds_its_note_even_after_the_reminder_moved_on() {
        let s = Store::memory();
        let tz = sp();
        let now = at(&tz, 2026, 10, 9, 12);
        s.save_note(&note("b", "Plantas", Some(at(&tz, 2026, 10, 9, 18)), Some("day"))).unwrap();
        let p = plan(&s, now, &tz).unwrap();
        remember_keys(&s, &p, now).unwrap();
        let fired = p[0].key;
        // o lembrete disparou e o app, ao abrir, já mudou a agenda: o número continua levando à nota
        let later = now + 7 * HOUR;
        let p2 = plan(&s, later, &tz).unwrap();
        remember_keys(&s, &p2, later).unwrap();
        assert_eq!(note_for_key(&s, fired).unwrap().as_deref(), Some("b"));
        assert_eq!(note_for_key(&s, 12345).unwrap(), None, "número que nunca foi agendado");
        // o que passou há mais de 30 dias sai, para a lista não crescer para sempre
        remember_keys(&s, &[], now + 31 * 24 * HOUR).unwrap();
        assert_eq!(note_for_key(&s, fired).unwrap(), None);
    }

    #[test]
    fn plan_has_a_ceiling_and_a_snooze_fires_once() {
        let s = Store::memory();
        let tz = sp();
        let now = at(&tz, 2026, 10, 9, 12);
        for i in 0..20 {
            s.save_note(&note(&format!("n{i}"), "Toda hora", Some(now + HOUR + i), Some("day"))).unwrap();
        }
        assert_eq!(plan(&s, now, &tz).unwrap().len(), PLAN_MAX);
        let s = Store::memory();
        s.save_note(&note("r", "Remédio", Some(now + 5 * HOUR), Some("day"))).unwrap();
        s.set_snooze("r", Some(now + 10 * 60 * 1000)).unwrap();
        let p = plan(&s, now, &tz).unwrap();
        assert_eq!(p[0].at, now + 10 * 60 * 1000, "a volta do adiamento vem primeiro");
        assert_eq!(p.iter().filter(|x| x.at == now + 10 * 60 * 1000).count(), 1, "e não vira série");
        assert_eq!(p.len(), 1 + 14);
    }

    #[test]
    fn repeating_reminders_move_to_the_next_time() {
        let s = Store::memory();
        let now = 1_791_600_000_000;
        s.save_note(&note("r", "Água das plantas", Some(now - 60_000), Some("day"))).unwrap();
        let alerts = take_due(&s, now, &sp()).unwrap();
        assert_eq!(alerts.len(), 1);
        let n = &s.list_reminders(&Filter::default(), "", false).unwrap()[0];
        assert_eq!(n.reminder_at, Some(now - 60_000 + 24 * HOUR));
        assert!(!n.reminder_done);
        assert_eq!(n.reminder_repeat.as_deref(), Some("day"));
    }

    #[test]
    fn many_at_once_become_a_summary() {
        let alerts: Vec<Alert> = (0..7).map(|i| Alert { id: format!("n{i}"), title: format!("Nota {i}"), at: 0, late: true, repeats: false }).collect();
        let n = notices(&alerts);
        assert_eq!(n.len(), 3);
        assert_eq!(n[2].title, "Mais 5 lembretes");
        assert_eq!(n[2].note, None);
        assert_eq!(notices(&alerts[..1])[0].note.as_deref(), Some("n0"));
    }
}

#[cfg(test)]
mod props {
    //! A próxima vez de um lembrete que se repete, conferida contra a conta feita à mão (passo a passo desde a data
    //! original), para quaisquer datas: nunca pula uma ocorrência nem repete a mesma.
    use super::*;
    use chrono::{Datelike, FixedOffset, NaiveDateTime, Timelike};
    use proptest::prelude::*;

    fn tz() -> FixedOffset {
        FixedOffset::west_opt(3 * 3600).unwrap_or_else(|| FixedOffset::east_opt(0).unwrap())
    }

    /// Ocorrência k (1, 2, …) contada à mão, no horário local.
    fn nth(anchor: NaiveDateTime, repeat: &str, k: u32) -> NaiveDateTime {
        match repeat {
            "day" => anchor + chrono::Duration::days(k as i64),
            "week" => anchor + chrono::Duration::days(7 * k as i64),
            "month" => anchor.checked_add_months(Months::new(k)).unwrap(),
            _ => anchor.checked_add_months(Months::new(12 * k)).unwrap(),
        }
    }

    proptest! {
        #[test]
        fn next_is_the_first_occurrence_after_now(
            at in 946_684_800_000i64..2_000_000_000_000,
            gap in 0i64..(6 * 366 * 86_400_000),
            repeat in prop::sample::select(vec!["day", "week", "month", "year"]),
        ) {
            let now = at + gap;
            let next = next_occurrence(at, repeat, now, &tz()).unwrap();
            prop_assert!(next > now);
            let anchor = tz().timestamp_millis_opt(at).unwrap().naive_local();
            // à mão: a primeira ocorrência depois de `now`
            let mut k = 1;
            let expected = loop {
                let ms = tz().from_local_datetime(&nth(anchor, repeat, k)).unwrap().timestamp_millis();
                if ms > now { break ms; }
                k += 1;
            };
            prop_assert_eq!(next, expected);
            // mesmo horário do dia; mês e ano no mesmo dia (ou o último do mês, quando ele não existe)
            let local = tz().timestamp_millis_opt(next).unwrap().naive_local();
            prop_assert_eq!((local.hour(), local.minute()), (anchor.hour(), anchor.minute()));
            if repeat == "month" || repeat == "year" {
                prop_assert!(local.day() == anchor.day() || local.day() < anchor.day() && (local + chrono::Duration::days(1)).day() == 1);
            }
        }
    }
}

#[cfg(test)]
mod snooze_tests {
    //! Adiar e concluir lembretes que se repetem: a série nunca sai do horário dela.
    use super::*;
    use crate::store::{Filter, NoteInput};
    use chrono::FixedOffset;
    use serde_json::json;

    const MIN: Millis = 60_000;

    fn tz() -> FixedOffset {
        FixedOffset::west_opt(3 * 3600).unwrap()
    }

    fn at(d: u32, h: u32, m: u32) -> Millis {
        tz().with_ymd_and_hms(2026, 10, d, h, m, 0).single().unwrap().timestamp_millis()
    }

    fn note(id: &str, reminder: Millis, repeat: Option<&str>) -> NoteInput {
        NoteInput {
            id: id.into(),
            title: "Água das plantas".into(),
            body: json!({"type":"doc","content":[{"type":"paragraph"}]}),
            category_id: None,
            color: "none".into(),
            pinned: false,
            archived: false,
            trashed_at: None,
            reminder_at: Some(reminder),
            reminder_done: false,
            reminder_doing: false,
            status_on: false,
            reminder_repeat: repeat.map(str::to_string),
            emoji: None,
            tags: vec![],
        }
    }

    fn reminder_at(s: &Store, id: &str) -> (Option<Millis>, bool) {
        let n = s.get_note(id).unwrap().unwrap();
        (n.reminder_at, n.reminder_done)
    }

    #[test]
    fn snoozing_a_repeating_reminder_keeps_the_series_time() {
        let s = Store::memory();
        s.save_note(&note("n1", at(10, 9, 0), Some("day"))).unwrap();
        assert_eq!(take_due(&s, at(10, 9, 0), &tz()).unwrap().len(), 1);
        assert_eq!(reminder_at(&s, "n1").0, Some(at(11, 9, 0)), "a próxima vez já entrou");
        let edited = s.get_note("n1").unwrap().unwrap().updated_at;
        snooze(&s, "n1", at(10, 9, 0) + 10 * MIN).unwrap();
        // a série continua às 9h; o adiamento avisa às 9h10, uma vez
        assert_eq!(reminder_at(&s, "n1").0, Some(at(11, 9, 0)));
        assert!(take_due(&s, at(10, 9, 5), &tz()).unwrap().is_empty());
        let again = take_due(&s, at(10, 9, 10), &tz()).unwrap();
        assert_eq!(again.len(), 1);
        assert!(take_due(&s, at(10, 9, 20), &tz()).unwrap().is_empty(), "avisa uma vez só");
        assert_eq!(reminder_at(&s, "n1").0, Some(at(11, 9, 0)));
        assert_eq!(s.get_note("n1").unwrap().unwrap().updated_at, edited, "adiar não é editar a nota");
    }

    #[test]
    fn snoozing_a_one_time_reminder_moves_it() {
        let s = Store::memory();
        s.save_note(&note("n1", at(10, 9, 0), None)).unwrap();
        take_due(&s, at(10, 9, 0), &tz()).unwrap();
        snooze(&s, "n1", at(10, 9, 10)).unwrap();
        assert_eq!(reminder_at(&s, "n1"), (Some(at(10, 9, 10)), false));
        assert_eq!(take_due(&s, at(10, 9, 10), &tz()).unwrap().len(), 1);
    }

    #[test]
    fn completing_a_repeating_reminder_goes_to_the_next_time() {
        let s = Store::memory();
        s.save_note(&note("n1", at(10, 9, 0), Some("week"))).unwrap();
        complete(&s, "n1", at(10, 8, 0), &tz()).unwrap();
        assert_eq!(reminder_at(&s, "n1"), (Some(at(17, 9, 0)), false), "pula esta vez; a série continua");
        s.save_note(&note("n2", at(10, 9, 0), None)).unwrap();
        complete(&s, "n2", at(10, 8, 0), &tz()).unwrap();
        assert_eq!(reminder_at(&s, "n2"), (Some(at(10, 9, 0)), true));
    }

    fn status(s: &Store, id: &str) -> Status {
        let n = s.get_note(id).unwrap().unwrap();
        Status::of(n.reminder_done, n.reminder_doing)
    }

    #[test]
    fn status_goes_red_yellow_green_and_back_without_editing_the_note() {
        let s = Store::memory();
        s.save_note(&note("n1", at(10, 9, 0), None)).unwrap();
        let edited = s.get_note("n1").unwrap().unwrap().updated_at;
        assert_eq!(status(&s, "n1"), Status::Todo);
        set_status(&s, "n1", Status::Doing, at(10, 8, 0), &tz()).unwrap();
        assert_eq!(status(&s, "n1"), Status::Doing);
        set_status(&s, "n1", Status::Done, at(10, 8, 0), &tz()).unwrap();
        assert_eq!(status(&s, "n1"), Status::Done);
        assert!(!s.get_note("n1").unwrap().unwrap().reminder_doing, "verde não guarda o amarelo junto");
        set_status(&s, "n1", Status::Doing, at(10, 8, 0), &tz()).unwrap();
        assert_eq!(status(&s, "n1"), Status::Doing, "do verde dá para voltar ao amarelo");
        set_status(&s, "n1", Status::Todo, at(10, 8, 0), &tz()).unwrap();
        assert_eq!(status(&s, "n1"), Status::Todo);
        assert_eq!(s.get_note("n1").unwrap().unwrap().updated_at, edited, "mudar o status não é editar a nota");
        // o amarelo vai junto no Y.Doc (sync e outros aparelhos)
        set_status(&s, "n1", Status::Doing, at(10, 8, 0), &tz()).unwrap();
        let state = s.ydoc("n1").unwrap().unwrap();
        assert!(crate::ydoc::to_note("n1", &state).unwrap().reminder_doing);
    }

    #[test]
    fn green_on_a_repeating_reminder_moves_on_and_starts_red() {
        let s = Store::memory();
        s.save_note(&note("n1", at(10, 9, 0), Some("day"))).unwrap();
        set_status(&s, "n1", Status::Doing, at(10, 8, 0), &tz()).unwrap();
        set_status(&s, "n1", Status::Done, at(10, 8, 0), &tz()).unwrap();
        assert_eq!(reminder_at(&s, "n1"), (Some(at(11, 9, 0)), false));
        assert_eq!(status(&s, "n1"), Status::Todo);
    }

    #[test]
    fn a_note_without_a_reminder_gets_a_status_from_the_menu_and_can_lose_it() {
        let s = Store::memory();
        let mut n = note("n1", at(10, 9, 0), None);
        n.reminder_at = None;
        s.save_note(&n).unwrap();
        let on = |s: &Store| s.get_note("n1").unwrap().unwrap().status_on;
        assert!(!on(&s));
        assert!(s.list_board(&Filter::default(), "").unwrap().is_empty(), "sem lembrete e sem status, fora do Kanban");
        set_status(&s, "n1", Status::Doing, at(10, 8, 0), &tz()).unwrap();
        assert!(on(&s));
        assert_eq!(status(&s, "n1"), Status::Doing);
        assert_eq!(s.list_board(&Filter::default(), "").unwrap().len(), 1);
        // verde sem lembrete não reagenda nada: só fica concluída
        set_status(&s, "n1", Status::Done, at(10, 8, 0), &tz()).unwrap();
        assert_eq!(status(&s, "n1"), Status::Done);
        assert_eq!(s.get_note("n1").unwrap().unwrap().reminder_at, None);
        clear_status(&s, "n1").unwrap();
        assert!(!on(&s));
        assert_eq!(status(&s, "n1"), Status::Todo);
        assert!(s.list_board(&Filter::default(), "").unwrap().is_empty());
        // vai junto no Y.Doc
        set_status(&s, "n1", Status::Todo, at(10, 8, 0), &tz()).unwrap();
        assert!(crate::ydoc::to_note("n1", &s.ydoc("n1").unwrap().unwrap()).unwrap().status_on);
    }

    #[test]
    fn a_note_with_a_reminder_keeps_its_status_after_clear() {
        let s = Store::memory();
        s.save_note(&note("n1", at(10, 9, 0), None)).unwrap();
        set_status(&s, "n1", Status::Doing, at(10, 8, 0), &tz()).unwrap();
        assert!(!s.get_note("n1").unwrap().unwrap().status_on, "com lembrete o status vem dele");
        clear_status(&s, "n1").unwrap();
        assert_eq!(status(&s, "n1"), Status::Doing);
        assert_eq!(s.list_board(&Filter::default(), "").unwrap().len(), 1);
    }

    #[test]
    fn reminders_of_archived_notes_are_listed_and_counted() {
        let s = Store::memory();
        let mut n = note("n1", at(10, 9, 0), None);
        n.archived = true;
        s.save_note(&n).unwrap();
        assert_eq!(s.list_reminders(&Filter::default(), "", false).unwrap().len(), 1);
        assert_eq!(s.view_counts(&Filter::default(), "").unwrap().reminders, 1);
        assert_eq!(s.view_counts(&Filter::default(), "").unwrap().notes, 0, "a nota arquivada não conta em Notas");
    }
}
