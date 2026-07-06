use std::path::PathBuf;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Daily log files are kept for this many days; older ones are pruned on rotation
/// so `~/Library/Logs/Vivid` doesn't grow unbounded.
const MAX_LOG_FILES: usize = 14;

pub fn init() {
    let log_dir = log_directory();
    std::fs::create_dir_all(&log_dir).ok();

    // `rolling::daily` never prunes; build the appender explicitly so we can cap
    // retention to MAX_LOG_FILES.
    let file_appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("vivid.log")
        .max_log_files(MAX_LOG_FILES)
        .build(&log_dir)
        .expect("failed to initialize rolling log appender");
    let (non_blocking_writer, guard) = tracing_appender::non_blocking(file_appender);
    // Intentionally leaked: guard keeps the background flusher alive for the process lifetime.
    Box::leak(Box::new(guard));

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("vivid_lib=debug,info"));

    let console_layer = fmt::layer().with_target(false).compact();

    let file_layer = fmt::layer()
        .with_target(false)
        .with_ansi(false)
        .with_writer(non_blocking_writer);

    let _ = tracing_subscriber::registry()
        .with(env_filter)
        .with(console_layer)
        .with(file_layer)
        .try_init();
}

fn log_directory() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join("Library").join("Logs").join("Vivid")
}
