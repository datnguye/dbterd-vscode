import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { CloseIcon, SearchIcon } from "./icons";
import "./EntityFilter.css";

interface EntityFilterProps {
  value: string;
  onChange: (next: string) => void;
  matchCount: number;
  totalCount: number;
}

// Press `/` anywhere in the canvas to focus the filter — same convention as
// GitHub, Slack, Linear. Ignored while typing in another input/textarea so it
// never steals keystrokes from the details pane or the user's editor focus.
function shouldHandleSlash(event: globalThis.KeyboardEvent): boolean {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  if (!target) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return false;
  return true;
}

export const EntityFilter = memo(function EntityFilter({
  value,
  onChange,
  matchCount,
  totalCount,
}: EntityFilterProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (!shouldHandleSlash(event)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      onChange(event.target.value);
    },
    [onChange],
  );

  const handleKey = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (value) {
          onChange("");
        } else {
          inputRef.current?.blur();
        }
      }
    },
    [onChange, value],
  );

  const clear = useCallback((): void => {
    onChange("");
    inputRef.current?.focus();
  }, [onChange]);

  const hasQuery = value.length > 0;
  const noMatches = hasQuery && matchCount === 0;

  return (
    <div
      className={`erd-filter${noMatches ? " erd-filter-empty" : ""}`}
      role="search"
      aria-label="Filter entities"
    >
      <span className="erd-filter-icon" aria-hidden="true">
        <SearchIcon size={14} />
      </span>
      <input
        ref={inputRef}
        type="search"
        className="erd-filter-input"
        placeholder="Filter entities…  ( / )"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
        spellCheck={false}
        autoComplete="off"
        aria-label="Filter entities by name"
      />
      {hasQuery ? (
        <span className="erd-filter-count" aria-live="polite">
          {matchCount}/{totalCount}
        </span>
      ) : null}
      {hasQuery ? (
        <button
          type="button"
          className="erd-filter-clear"
          onClick={clear}
          title="Clear filter (Esc)"
          aria-label="Clear filter"
        >
          <CloseIcon size={12} />
        </button>
      ) : null}
    </div>
  );
});
