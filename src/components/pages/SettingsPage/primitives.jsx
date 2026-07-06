/**
 * Shared building blocks for the settings panes. Every pane is a card of
 * titled sections containing rows; centralizing the markup here keeps the panes
 * declarative and the structure/classes consistent across all of them.
 */

/** A settings tab's outer card, with an optional title header. */
export function SettingsPane({ title, children }) {
  return (
    <div className="settings-pane">
      <div className="settings-tab-card">
        {title && <div className="settings-card-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** A titled section within a pane. Children supply the section body. */
export function SettingsSection({ title, children }) {
  return (
    <section className="settings-section">
      {title && <h2 className="settings-section-title">{title}</h2>}
      {children}
    </section>
  );
}

/**
 * A single settings row: optional leading icon, a label + description, and a
 * trailing control (passed as children — a toggle, button, or Select).
 */
export function SettingRow({
  icon: Icon,
  iconColor,
  label,
  desc,
  className = 'settings-toggle-row',
  children,
}) {
  return (
    <div className={className}>
      {Icon && (
        <Icon
          size={16}
          className="settings-row-icon"
          style={iconColor ? { color: iconColor } : undefined}
        />
      )}
      <div className="settings-toggle-text">
        <span className="settings-toggle-label">{label}</span>
        {desc != null && <span className="settings-toggle-desc">{desc}</span>}
      </div>
      {children}
    </div>
  );
}

/** The pill on/off switch used throughout settings. */
export function ToggleSwitch({ on, onToggle, disabled = false, title, ariaLabel, style }) {
  return (
    <button
      className={`settings-toggle-btn ${on ? 'on' : 'off'}`}
      onClick={() => !disabled && onToggle(!on)}
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      title={title}
      style={style}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}
