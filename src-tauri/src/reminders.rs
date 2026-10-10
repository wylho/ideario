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

/// Próxima vez de um lembrete que se repete, depois de `now`, no mesmo horário local. Mês e ano contam a partir da
/// data original (31/jan, todo mês → 28 ou 29/fev → 31/mar), sem escorregar.
pub fn next_occurrence<Tz: TimeZone>(at: Millis, repeat: &str, now: Millis, tz: &Tz) -> Option<Millis> {
    let anchor = tz.timestamp_millis_opt(at).single()?.naive_local();
    let step = |k: u32| -> Option<NaiveDateTime> {
        match repeat {
            "day" => anchor.checked_add_days(Days::new(k as u64)),
            "week" => anchor.checked_add_days(Days::new(7 * k as u64)),
            "month" => anchor.checked_add_months(Months::new(k)),
            "year" => anchor.checked_add_months(Months::new(12 * k)),
            _ => None,
        }
    };
    // Começa perto de `now` (um lembrete diário de anos atrás não precisa de milhares de voltas).
    let elapsed_days = ((now - at).max(0) / 86_400_000) as u32;
    let mut k = match repeat {
        "day" => elapsed_days.saturating_sub(1).max(1),
        "week" => (elapsed_days / 7).saturating_sub(1).max(1),
        "month" => (elapsed_days / 31).saturating_sub(1).max(1),
        _ => (elapsed_days / 366).saturating_sub(1).max(1),
    };
    loop {
        let local = step(k)?;
        // Horário que não existe (início do horário de verão): uma hora depois.
        let when = tz.from_local_datetime(&local).earliest().or_else(|| tz.from_local_datetime(&(local + chrono::Duration::hours(1))).earliest())?;
        let ms = when.timestamp_millis();
        if ms > now {
            return Some(ms);
        }
        k += 1;
    }
}

/// O que venceu até `now` e ainda não foi avisado neste aparelho. Marca como avisado e reagenda os que se repetem.
pub fn take_due<Tz: TimeZone>(store: &Store, now: Millis, tz: &Tz) -> Result<Vec<Alert>> {
    let mut out = Vec::new();
    for DueReminder { id, title, at, repeat } in store.due_reminders(now)? {
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
            reminder_repeat: repeat.map(str::to_string),
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
