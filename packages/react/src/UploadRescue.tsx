import type { RecoveryState, UploadRescueController } from "@uploadrescue/core";
import {
  TONE_ICONS,
  getRecoveryView,
  runViewAction,
  type RecoveryLabels,
  type RecoveryView,
  type ViewAction,
  type ViewActionId,
} from "@uploadrescue/ui";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  useUploadRecovery,
  useUploadRescue,
  type UploadRecoveryApi,
  type UseUploadRescueOptions,
} from "./hooks";

export interface UploadRescueRenderProps<TResult> {
  state: RecoveryState<TResult>;
  view: RecoveryView;
  /** Run a view action (`select` opens the file picker). */
  act: (id: ViewActionId) => void;
  api: UploadRecoveryApi<TResult>;
}

interface UploadRescueUiProps<TResult> {
  /** Accept attribute for the file picker. Defaults to `acceptedTypes`. */
  accept?: string;
  labels?: Partial<RecoveryLabels>;
  theme?: "light" | "dark" | "auto";
  className?: string;
  style?: CSSProperties;
  /** Accessible name. Default "File upload". */
  label?: string;
  /** Replace the whole UI. */
  children?: (props: UploadRescueRenderProps<TResult>) => ReactNode;
  /** Replace action buttons. */
  renderButton?: (action: ViewAction, onClick: () => void) => ReactNode;
  /** Replace the error/warning message area. */
  renderError?: (view: RecoveryView, state: RecoveryState<TResult>) => ReactNode;
}

export type UploadRescueProps<TResult = unknown> = UploadRescueUiProps<TResult> &
  (
    | (UseUploadRescueOptions<TResult> & { controller?: undefined })
    | { controller: UploadRescueController<TResult> }
  );

/**
 * Drop-in upload widget with failure detection and recovery.
 *
 * Uncontrolled: pass `upload`/`onUpload` plus options.
 * Controlled: pass a `controller` from `useUploadRescue()` to share state.
 */
export function UploadRescue<TResult = unknown>(props: UploadRescueProps<TResult>) {
  if (props.controller) return <ControlledUploadRescue {...props} controller={props.controller} />;
  return (
    <UncontrolledUploadRescue
      {...(props as UploadRescueUiProps<TResult> & UseUploadRescueOptions<TResult>)}
    />
  );
}

function UncontrolledUploadRescue<TResult>(
  props: UploadRescueUiProps<TResult> & UseUploadRescueOptions<TResult>,
) {
  const {
    accept,
    labels,
    theme,
    className,
    style,
    label,
    children,
    renderButton,
    renderError,
    ...options
  } = props;
  const api = useUploadRescue<TResult>(options);
  return (
    <UploadRescueView
      api={api}
      ui={{
        accept: accept ?? options.acceptedTypes?.join(","),
        labels,
        theme,
        className,
        style,
        label,
        children,
        renderButton,
        renderError,
      }}
    />
  );
}

function ControlledUploadRescue<TResult>(
  props: UploadRescueUiProps<TResult> & { controller: UploadRescueController<TResult> },
) {
  const api = useUploadRecovery(props.controller);
  const accept = props.accept ?? props.controller.getConfig().acceptedTypes?.join(",");
  return <UploadRescueView api={api} ui={{ ...props, accept }} />;
}

function Icon({ tone }: { tone: RecoveryView["tone"] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={tone === "progress" ? "ur-icon ur-icon--spin" : "ur-icon"}
    >
      <path d={TONE_ICONS[tone]} />
    </svg>
  );
}

function UploadRescueView<TResult>({
  api,
  ui,
}: {
  api: UploadRecoveryApi<TResult>;
  ui: UploadRescueUiProps<TResult>;
}) {
  const { state, controller } = api;
  const config = controller.getConfig();
  const view = getRecoveryView(state, {
    ...(ui.labels ? { labels: ui.labels } : {}),
    showRecoveryButton: config.recovery?.showButton ?? true,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const focusedAction = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const act = (id: ViewActionId) => {
    if (id === "select") {
      inputRef.current?.click();
      return;
    }
    const result = runViewAction(controller as UploadRescueController<unknown>, id);
    // Errors are reflected in state; avoid unhandled rejections.
    if (result) result.catch(() => undefined);
  };
  const selectFiles = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) api.select(file).catch(() => undefined);
  };

  // Keep keyboard focus on the action area when buttons change between states.
  useEffect(() => {
    const id = focusedAction.current;
    if (!id || !contentRef.current) return;
    const same = contentRef.current.querySelector<HTMLButtonElement>(`[data-action="${id}"]`);
    (same ?? contentRef.current.querySelector<HTMLButtonElement>("button"))?.focus();
    focusedAction.current = null;
  }, [state.status]);

  const dragProps = view.selectable
    ? {
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          setDragging(true);
        },
        onDragLeave: (e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setDragging(false);
          selectFiles(e.dataTransfer.files);
        },
      }
    : {};

  const button = (action: ViewAction) => {
    const onClick = () => {
      focusedAction.current = action.id;
      act(action.id);
    };
    if (ui.renderButton) return <span key={action.id}>{ui.renderButton(action, onClick)}</span>;
    return (
      <button
        key={action.id}
        type="button"
        data-action={action.id}
        className={`ur-button ur-button--${action.variant}`}
        onClick={onClick}
      >
        {action.label}
      </button>
    );
  };

  const isProblem = view.tone === "error" || view.tone === "warning";
  const content = ui.children ? (
    ui.children({ state, view, act, api })
  ) : (
    <div className="ur-content" ref={contentRef}>
      {isProblem && ui.renderError ? (
        ui.renderError(view, state)
      ) : (
        <div className="ur-header">
          <Icon tone={view.tone} />
          <div className="ur-text">
            <p className="ur-title">{view.title}</p>
            {view.description ? <p className="ur-description">{view.description}</p> : null}
          </div>
        </div>
      )}
      {view.file && view.status !== "idle" ? (
        <div className="ur-file">
          <span className="ur-file-name" title={view.file.name}>
            {view.file.name}
          </span>
          <span className="ur-file-size">{view.file.size}</span>
        </div>
      ) : null}
      {view.progress ? (
        <div
          className="ur-progress"
          role="progressbar"
          aria-label={view.progress.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            view.progress.value === null ? undefined : Math.round(view.progress.value * 100)
          }
          data-indeterminate={view.progress.value === null ? "true" : undefined}
        >
          <div
            className="ur-progress-bar"
            style={
              view.progress.value === null
                ? undefined
                : { width: `${Math.round(view.progress.value * 100)}%` }
            }
          />
        </div>
      ) : null}
      {view.stats.length ? (
        <dl className="ur-stats">
          {view.stats.map((s) => (
            <div className="ur-stat" key={s.id} data-stat={s.id}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {view.actions.length ? <div className="ur-actions">{view.actions.map(button)}</div> : null}
    </div>
  );

  return (
    <div
      role="group"
      aria-label={ui.label ?? "File upload"}
      aria-busy={view.busy}
      className={["ur-widget", ui.className].filter(Boolean).join(" ")}
      style={ui.style}
      data-theme={ui.theme ?? "auto"}
      data-tone={view.tone}
      data-status={view.status}
      data-dragging={dragging ? "true" : undefined}
      {...dragProps}
    >
      {content}
      <div
        className="ur-sr-only"
        aria-live={view.urgent ? "assertive" : "polite"}
        aria-atomic="true"
      >
        {view.announcement}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="ur-sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={ui.accept}
        onChange={(e) => {
          selectFiles(e.currentTarget.files);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}
