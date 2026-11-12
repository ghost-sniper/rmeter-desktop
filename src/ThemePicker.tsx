import { themes, ThemeId } from "./themes";
import "./themes.css";

export default function ThemePicker({
  theme,
  onChange,
}: {
  theme: ThemeId;
  onChange: (theme: ThemeId) => void;
}) {
  return (
    <div className="theme-grid">
      {themes.map((item) => (
        <button
          key={item.id}
          type="button"
          className="theme-option"
          data-preview-theme={item.id}
          aria-label={item.name}
          aria-pressed={theme === item.id}
          onClick={() => onChange(item.id)}
        >
          <span className="theme-thumbnail">
            {"image" in item ? (
              <img src={item.image} alt="" loading="lazy" />
            ) : (
              <span className="theme-mini-window">
                <i />
                <i />
                <i />
              </span>
            )}
            <span className="theme-swatches" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {theme === item.id && (
              <span className="theme-check" aria-hidden="true">
                ✓
              </span>
            )}
          </span>
          <strong>{item.name}</strong>
          <small>{item.caption}</small>
        </button>
      ))}
    </div>
  );
}
