import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { calculate, type AngleMode } from "./api";
import "./App.css";

type Theme = "dark" | "light";

interface HistoryItem {
  id: number;
  expression: string;
  result: string;
  angleMode: AngleMode;
}

interface KeyDefinition {
  label: string;
  insert?: string;
  action?: "clear" | "backspace" | "evaluate";
  tone?: "accent" | "operator" | "utility";
  ariaLabel?: string;
}

const scientificKeys: KeyDefinition[] = [
  { label: "sin", insert: "sin(", tone: "utility" },
  { label: "cos", insert: "cos(", tone: "utility" },
  { label: "tan", insert: "tan(", tone: "utility" },
  { label: "π", insert: "pi", tone: "utility", ariaLabel: "pi" },
  { label: "e", insert: "e", tone: "utility" },
  { label: "sin⁻¹", insert: "asin(", tone: "utility", ariaLabel: "inverse sine" },
  { label: "cos⁻¹", insert: "acos(", tone: "utility", ariaLabel: "inverse cosine" },
  { label: "tan⁻¹", insert: "atan(", tone: "utility", ariaLabel: "inverse tangent" },
  { label: "xʸ", insert: "^", tone: "operator", ariaLabel: "power" },
  { label: "√", insert: "sqrt(", tone: "utility", ariaLabel: "square root" },
  { label: "ln", insert: "ln(", tone: "utility" },
  { label: "log", insert: "log(", tone: "utility" },
  { label: "(", insert: "(", tone: "utility" },
  { label: ")", insert: ")", tone: "utility" },
  { label: "!", insert: "!", tone: "utility", ariaLabel: "factorial" }
];

const numberKeys: KeyDefinition[] = [
  { label: "AC", action: "clear", tone: "accent", ariaLabel: "AC: clear expression" },
  { label: "⌫", action: "backspace", tone: "accent", ariaLabel: "backspace" },
  { label: "%", insert: "%", tone: "operator", ariaLabel: "percent" },
  { label: "÷", insert: "/", tone: "operator", ariaLabel: "divide" },
  { label: "7", insert: "7" },
  { label: "8", insert: "8" },
  { label: "9", insert: "9" },
  { label: "×", insert: "*", tone: "operator", ariaLabel: "multiply" },
  { label: "4", insert: "4" },
  { label: "5", insert: "5" },
  { label: "6", insert: "6" },
  { label: "−", insert: "-", tone: "operator", ariaLabel: "subtract" },
  { label: "1", insert: "1" },
  { label: "2", insert: "2" },
  { label: "3", insert: "3" },
  { label: "+", insert: "+", tone: "operator", ariaLabel: "add" },
  { label: "0", insert: "0" },
  { label: ".", insert: "." },
  { label: "=", action: "evaluate", tone: "accent", ariaLabel: "calculate" }
];

export default function App() {
  const [expression, setExpression] = useState("");
  const [result, setResult] = useState("0");
  const [angleMode, setAngleMode] = useState<AngleMode>("RAD");
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
  );
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const requestId = useRef(0);
  const pendingRequest = useRef<{ controller: AbortController; timeout: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingSelection = useRef<{ position: number; focus: boolean } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => () => {
    requestId.current += 1;
    pendingRequest.current?.controller.abort();
    window.clearTimeout(pendingRequest.current?.timeout);
  }, []);

  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    if (selection) {
      if (selection.focus) inputRef.current?.focus();
      inputRef.current?.setSelectionRange(selection.position, selection.position);
      pendingSelection.current = null;
    }
  }, [expression]);

  function cancelPending() {
    requestId.current += 1;
    pendingRequest.current?.controller.abort();
    window.clearTimeout(pendingRequest.current?.timeout);
    pendingRequest.current = null;
    setIsLoading(false);
  }

  function changeExpression(value: string, position?: number, focus = false) {
    if (value.length > 256) {
      setError("Expression must be 256 characters or fewer.");
      return;
    }
    cancelPending();
    setError("");
    setResult(value.trim() ? "—" : "0");
    pendingSelection.current = position === undefined ? null : { position, focus };
    setExpression(value);
  }

  async function evaluate() {
    const value = expression.trim();
    if (isLoading) {
      return;
    }
    if (!value) {
      setError("Enter an expression to calculate.");
      return;
    }

    const currentRequest = ++requestId.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      if (currentRequest !== requestId.current) return;
      cancelPending();
      setError("The calculation timed out. Please try again.");
    }, 8000);
    pendingRequest.current = { controller, timeout };
    setIsLoading(true);
    setError("");
    setResult("—");

    try {
      const response = await calculate(value, angleMode, controller.signal);
      if (currentRequest !== requestId.current) {
        return;
      }
      setResult(response.formattedResult);
      setHistory((items) =>
        [
          {
            id: currentRequest,
            expression: value,
            result: response.formattedResult,
            angleMode
          },
          ...items
        ].slice(0, 12)
      );
    } catch (caught) {
      if (currentRequest !== requestId.current) {
        return;
      }
      setError(
        caught instanceof Error ? caught.message : "The calculator service is unavailable."
      );
    } finally {
      window.clearTimeout(timeout);
      if (currentRequest === requestId.current) {
        pendingRequest.current = null;
        setIsLoading(false);
      }
    }
  }

  function handleKey(key: KeyDefinition, focusInput = true) {
    if (key.action === "clear") {
      changeExpression("", 0, focusInput);
    } else if (key.action === "evaluate") {
      void evaluate();
    } else {
      const start = inputRef.current?.selectionStart ?? expression.length;
      const end = inputRef.current?.selectionEnd ?? expression.length;
      const from = key.action === "backspace" && start === end ? Math.max(0, start - 1) : start;
      const inserted = key.insert ?? "";
      changeExpression(
        expression.slice(0, from) + inserted + expression.slice(end),
        from + inserted.length,
        focusInput
      );
    }
  }

  function handleKeyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void evaluate();
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleKey({ label: "AC", action: "clear" });
    }
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="site-header">
        <a className="brand" href="/" aria-label="BroCalc home">
          <span className="brand-mark">∑</span>
          <span>
            <strong>BroCalc</strong>
            <small>Scientific, server powered</small>
          </span>
        </a>
        <div className="header-actions">
          <a
            className="source-link"
            href="https://github.com/naikaakash/brorepo"
            target="_blank"
            rel="noreferrer"
          >
            Source ↗
          </a>
          <button
            className="icon-button"
            type="button"
            onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </header>

      <section className="hero-copy">
        <p className="eyebrow">Precise by design</p>
        <h1>Ideas in. Answers out.</h1>
        <p>A little curiosity. A little computation. Scientific math, calculated on the server.</p>
      </section>

      <div className="workspace">
        <section className="calculator-card" aria-label="Scientific calculator">
          <div className="mode-row">
            <div className="segmented" role="group" aria-label="Angle mode">
              {(["RAD", "DEG"] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={angleMode === mode ? "active" : ""}
                  onClick={() => {
                    if (mode !== angleMode) {
                      cancelPending();
                      setAngleMode(mode);
                      setResult(expression.trim() ? "—" : "0");
                      setError("");
                    }
                  }}
                  aria-pressed={angleMode === mode}
                >
                  {mode}
                </button>
              ))}
            </div>
            <span className="api-status">
              <span aria-hidden="true" />
              API calculation
            </span>
          </div>

          <div className="display">
            <label htmlFor="expression" className="sr-only">
              Mathematical expression
            </label>
            <input
              ref={inputRef}
              id="expression"
              value={expression}
              onChange={(event) => changeExpression(event.target.value)}
              onKeyDown={handleKeyboard}
              placeholder="Enter an expression"
              autoComplete="off"
              spellCheck={false}
              maxLength={256}
              aria-describedby="expression-help"
              aria-invalid={Boolean(error)}
            />
            <div className="result-row">
              <span aria-hidden="true">=</span>
              <output aria-label="Result" aria-live="polite" aria-busy={isLoading}>
                {isLoading ? "Calculating…" : result}
              </output>
            </div>
            <p id="expression-help" className={`message ${error ? "error" : ""}`} role="status" aria-live="polite">
              {error || "Use explicit multiplication, for example 2*pi."}
            </p>
          </div>

          {[scientificKeys, numberKeys].map((group, index) => (
            <div className={`keypad ${index === 0 ? "scientific" : "numbers"}`} key={index}
              role="group" aria-label={index === 0 ? "Scientific functions" : "Numbers and operations"}>
              {group.map((key) => (
                <button
                  type="button"
                  key={key.label}
                  className={`key ${key.tone ?? ""} ${key.action === "evaluate" ? "equals" : ""} ${key.insert === "0" ? "zero" : ""}`}
                  onClick={(event) => handleKey(key, event.detail > 0)}
                  onPointerDown={(event) => event.preventDefault()}
                  aria-label={key.ariaLabel}
                  aria-disabled={isLoading && key.action === "evaluate"}
                >
                  {key.label}
                </button>
              ))}
            </div>
          ))}
        </section>

        <aside className="history-card">
          <div className="history-heading">
            <div>
              <p className="eyebrow">This session</p>
              <h2>History</h2>
            </div>
            {history.length > 0 && (
              <button type="button" aria-label="Clear history" onClick={() => setHistory([])}>
                Clear
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="empty-history">
              <span>↗</span>
              <p>Your calculations will appear here.</p>
            </div>
          ) : (
            <ol className="history-list">
              {history.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      cancelPending();
                      setError("");
                      setExpression(item.expression);
                      setAngleMode(item.angleMode);
                      setResult(item.result);
                      inputRef.current?.focus();
                    }}
                  >
                    <span>
                      {item.expression} <small>{item.angleMode}</small>
                    </span>
                    <strong>= {item.result}</strong>
                  </button>
                </li>
              ))}
            </ol>
          )}

          <div className="tips">
            <strong>Keyboard ready</strong>
            <span>Enter calculates · Esc clears</span>
          </div>
        </aside>
      </div>

      <footer>
        <span>No accounts. No saved calculations.</span>
        <span>Results may be approximate due to floating-point arithmetic.</span>
      </footer>
    </main>
  );
}
