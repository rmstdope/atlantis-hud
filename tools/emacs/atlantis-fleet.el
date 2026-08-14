;;; atlantis-fleet.el --- List the atlantis-hud agent fleet -*- lexical-binding: t; -*-

;; Emacs 28+ (json-parse-string, iso8601-parse).  No external dependencies.

;;; Commentary:

;; `M-x atlantis-fleet' opens a buffer listing every agent the fleet can have -
;; Xavier, Cerebro, Moira and the fifteen implementers - each with a state
;; glyph, role, state, and (for a working implementer) the bead it is on and
;; for how long.  It refreshes itself every 5 seconds.
;;
;; This is the list half of the fleet view (ah-vcf.2).  The live detail
;; window, and starting/killing agents, are ah-vcf.3 - RET, s and k are
;; unbound here on purpose.
;;
;; Data sources:
;;   - an implementer's status file, `.claude/implementers/<name>.state.json',
;;     written by `scripts/run-implementer' at every state transition (see
;;     ah-vcf.1): { state: "idle"|"working", bead, since, pid }.
;;   - `scripts/run-implementer --roster', the fifteen implementer names.
;;   - the interactive three (Xavier, Cerebro, Moira) have no such file; their
;;     liveness comes from scanning system processes for the `--name <Name>'
;;     argument their launchers pass.

;;; Code:

(require 'cl-lib)
(require 'json)
(require 'iso8601)
(require 'tabulated-list)
(require 'seq)
(require 'subr-x)

;;; The interactive roster

(defconst atlantis-fleet-interactive-agents
  '(("Xavier" . "planner")
    ("Cerebro" . "orchestrator")
    ("Moira" . "feedback"))
  "The three interactive agents, mirroring their launchers.")

;;; The pure core

(cl-defstruct atlantis-fleet-agent
  "One row of the fleet list."
  name role kind                       ; kind: 'interactive | 'implementer
  state                                ; 'up | 'working | 'idle | 'dead
  bead since external)

(defun atlantis-fleet--name-in-args-p (name args)
  "Non-nil if some string in ARGS names NAME via a whole-word \"--name NAME\"."
  (let ((needle (concat "--name[ \t]+" (regexp-quote name) "\\_>")))
    (cl-some (lambda (a) (and (stringp a) (string-match-p needle a))) args)))

(defun atlantis-fleet--derive-interactive (entry args owned)
  "Derive one interactive agent's row from (NAME . ROLE) ENTRY.

ARGS is the system process args list; OWNED the names Emacs itself started."
  (let ((name (car entry))
        (role (cdr entry)))
    (cond
     ((member name owned)
      (make-atlantis-fleet-agent :name name :role role :kind 'interactive
                                  :state 'up :bead nil :since nil :external nil))
     ((atlantis-fleet--name-in-args-p name args)
      (make-atlantis-fleet-agent :name name :role role :kind 'interactive
                                  :state 'up :bead nil :since nil :external t))
     (t
      (make-atlantis-fleet-agent :name name :role role :kind 'interactive
                                  :state 'dead :bead nil :since nil :external nil)))))

(defun atlantis-fleet--derive-implementer (name states pid-alive-p owned)
  "Derive one implementer's row for NAME.

STATES is an alist of (NAME . parsed-state-json-or-nil); PID-ALIVE-P a
predicate on a pid; OWNED the names Emacs itself started."
  (let* ((parsed (cdr (assoc name states)))
         (pid (and parsed (alist-get 'pid parsed)))
         (alive (and pid (funcall pid-alive-p pid))))
    (if (not alive)
        (make-atlantis-fleet-agent :name name :role "implementer" :kind 'implementer
                                    :state 'dead :bead nil :since nil :external nil)
      (let* ((raw-state (alist-get 'state parsed))
             (state (if (equal raw-state "working") 'working 'idle))
             (bead (alist-get 'bead parsed))
             (since (alist-get 'since parsed))
             (external (not (member name owned))))
        (make-atlantis-fleet-agent :name name :role "implementer" :kind 'implementer
                                    :state state :bead bead :since since :external external)))))

(defun atlantis-fleet--derive (roster interactive-agents states pid-alive-p args owned)
  "Return the fleet as a list of `atlantis-fleet-agent', interactive first.

ROSTER is the implementer name list, in the order they should be shown.
INTERACTIVE-AGENTS is an alist of (NAME . ROLE), normally
`atlantis-fleet-interactive-agents'.  STATES is an alist of (NAME .
parsed-state-json-or-nil).  PID-ALIVE-P is a predicate on a pid.  ARGS is the
system process args list.  OWNED is the set of agent names whose sessions
Emacs itself started (always empty until ah-vcf.3)."
  (append
   (mapcar (lambda (entry) (atlantis-fleet--derive-interactive entry args owned))
           interactive-agents)
   (mapcar (lambda (name) (atlantis-fleet--derive-implementer name states pid-alive-p owned))
           roster)))

;;; Formatting

(defun atlantis-fleet--glyph (state)
  "The single-character glyph for STATE, propertized."
  (cond
   ((memq state '(working up)) (propertize "●" 'face 'success))   ; ●
   ((eq state 'idle) (propertize "◌" 'face 'shadow))              ; ◌
   (t (propertize "○" 'face 'shadow))))                           ; ○

(defun atlantis-fleet--elapsed (since now)
  "How long ago SINCE (an ISO-8601 string, or nil) was, relative to NOW.

Renders as \"12m\", \"1h03\" or \"2d\".  Nil-safe: a nil SINCE, or one that
fails to parse, renders as the empty string."
  (if (null since)
      ""
    (condition-case nil
        (let* ((since-time (encode-time (iso8601-parse since)))
               (diff (max 0 (floor (float-time (time-subtract now since-time))))))
          (cond
           ((< diff 3600) (format "%dm" (/ diff 60)))
           ((< diff 86400) (format "%dh%02d" (/ diff 3600) (/ (mod diff 3600) 60)))
           (t (format "%dd" (/ diff 86400)))))
      (error ""))))

(defun atlantis-fleet--entry (agent now)
  "AGENT as a `tabulated-list-entries' element, evaluated at NOW."
  (let* ((state (atlantis-fleet-agent-state agent))
         (external (atlantis-fleet-agent-external agent))
         (agent-col (format "%s %s" (atlantis-fleet--glyph state) (atlantis-fleet-agent-name agent)))
         (role-col (atlantis-fleet-agent-role agent))
         (state-col (symbol-name state))
         (bead-col (cond (external "(external)")
                          ((atlantis-fleet-agent-bead agent))
                          (t "")))
         (for-col (if external "" (atlantis-fleet--elapsed (atlantis-fleet-agent-since agent) now))))
    (list (atlantis-fleet-agent-name agent)
          (vector agent-col role-col state-col bead-col for-col))))

;;; ah-vcf.3: the pure start/kill/launch decisions

(defconst atlantis-fleet--role-launch-commands
  '(("planner" . "scripts/run-planner")
    ("orchestrator" . "scripts/run-orchestrator")
    ("feedback" . "scripts/run-user-feedback"))
  "Launch command for each interactive role.")

(defun atlantis-fleet--launch-command (agent)
  "The command that launches AGENT.

A string for an interactive agent; a (COMMAND NAME) list for an
implementer, since its name is an argument rather than part of the
command name."
  (if (eq (atlantis-fleet-agent-kind agent) 'implementer)
      (list "scripts/run-implementer" (atlantis-fleet-agent-name agent))
    (or (cdr (assoc (atlantis-fleet-agent-role agent) atlantis-fleet--role-launch-commands))
        (error "atlantis-fleet: no launch command for role %s"
               (atlantis-fleet-agent-role agent)))))

(defun atlantis-fleet--session-buffer-name (agent)
  "The vterm buffer name that holds AGENT's live session."
  (format "*fleet: %s*" (atlantis-fleet-agent-name agent)))

(defun atlantis-fleet--alive-p (agent)
  "Non-nil if AGENT's state means a session is up (interactive or implementer)."
  (memq (atlantis-fleet-agent-state agent) '(up working idle)))

(defun atlantis-fleet--start-action (agent owned)
  "What `s' should do for AGENT, given OWNED session names.

One of `launch' (start a dead agent), `already-up' (an owned session is
already running) or `external' (a live session exists outside Emacs -
refuse rather than launch a second one)."
  (cond
   ((not (atlantis-fleet--alive-p agent)) 'launch)
   ((member (atlantis-fleet-agent-name agent) owned) 'already-up)
   (t 'external)))

(defun atlantis-fleet--kill-action (agent owned)
  "What `k' should do for AGENT, given OWNED session names.

One of `kill' (plain confirm), `kill-working' (an implementer mid-bead -
harder confirm), `external' (refuse - not ours to stop) or `dead'
(refuse - nothing to kill)."
  (cond
   ((not (atlantis-fleet--alive-p agent)) 'dead)
   ((not (member (atlantis-fleet-agent-name agent) owned)) 'external)
   ((and (eq (atlantis-fleet-agent-kind agent) 'implementer)
         (eq (atlantis-fleet-agent-state agent) 'working))
    'kill-working)
   (t 'kill)))

(defun atlantis-fleet--placeholder (agent)
  "The detail-window text for AGENT when it has no live view."
  (let ((name (atlantis-fleet-agent-name agent)))
    (if (atlantis-fleet-agent-external agent)
        (format "%s is running outside Emacs - no live view. Use the terminal that started it."
                name)
      (format "%s is not running. Press s to start it." name))))

;;; Impure readers - each trivially small so everything above stays pure

(defun atlantis-fleet--repo-root ()
  "The repository root above `default-directory', or an error."
  (or (locate-dominating-file default-directory ".claude/implementers")
      (error "atlantis-fleet: no .claude/implementers found above %s" default-directory)))

(defun atlantis-fleet--parse-roster (output)
  "Turn OUTPUT (one implementer name per line) into a list of names."
  (seq-filter (lambda (s) (not (string-empty-p s)))
              (mapcar #'string-trim (split-string output "\n"))))

(defvar-local atlantis-fleet--roster-cache nil
  "The roster, once read; buffer-local so a revert does not re-shell out.")

(defun atlantis-fleet--roster (repo-root)
  "The fifteen implementer names, via \"scripts/run-implementer --roster\"."
  (or atlantis-fleet--roster-cache
      (setq atlantis-fleet--roster-cache
            (atlantis-fleet--parse-roster
             (with-temp-buffer
               (call-process (expand-file-name "scripts/run-implementer" repo-root)
                              nil t nil "--roster")
               (buffer-string))))))

(defun atlantis-fleet--state-file-path (repo-root name)
  "Where NAME's status file lives, mirroring `statePath' in runImplementer.ts."
  (expand-file-name (format ".claude/implementers/%s.state.json" name) repo-root))

(defun atlantis-fleet--read-state-file (path)
  "The parsed contents of PATH, or nil if it is absent, unreadable or torn."
  (when (file-exists-p path)
    (condition-case nil
        (with-temp-buffer
          (insert-file-contents path)
          (json-parse-string (buffer-string) :object-type 'alist :array-type 'list
                              :null-object nil :false-object nil))
      (error nil))))

(defun atlantis-fleet--gather-states (repo-root roster)
  "The (NAME . parsed-state-json-or-nil) alist for every name in ROSTER."
  (mapcar (lambda (name)
            (cons name (atlantis-fleet--read-state-file
                        (atlantis-fleet--state-file-path repo-root name))))
          roster))

(defun atlantis-fleet--pid-alive-p (pid)
  "Non-nil if a process with PID currently exists."
  (and pid (process-attributes pid) t))

(defun atlantis-fleet--system-args ()
  "The command-line args string of every system process, as a list."
  (delq nil
        (mapcar (lambda (pid) (alist-get 'args (process-attributes pid)))
                (list-system-processes))))

(defun atlantis-fleet--owned-buffer-agent-name (buffer-name)
  "The agent name BUFFER-NAME names as a live session, or nil.

Matches only the plain session-buffer scheme (`--session-buffer-name'),
never the placeholder scheme (`*fleet: NAME (no view)*') - a placeholder
buffer names an agent with no live view, the opposite of owned."
  (and (string-match "\\`\\*fleet: \\([^()]+\\)\\*\\'" buffer-name)
       (match-string 1 buffer-name)))

(defun atlantis-fleet--owned ()
  "Agent names whose sessions this Emacs itself started.

Derived fresh from live buffers matching the session-buffer naming
scheme with a live process - no registry to go stale."
  (delq nil
        (mapcar (lambda (buffer)
                  (and (get-buffer-process buffer)
                       (atlantis-fleet--owned-buffer-agent-name (buffer-name buffer))))
                (buffer-list))))

;;; The detail window (ah-vcf.3)

(defvar-local atlantis-fleet--list-window nil
  "The list window of this fleet buffer's layout.")
(defvar-local atlantis-fleet--detail-window nil
  "The detail window of this fleet buffer's layout.")
(defvar-local atlantis-fleet--agents nil
  "The agents shown by the last revert, for lookup by name.")
(defvar-local atlantis-fleet--last-shown nil
  "The name of the agent last shown in the detail window.")

(defun atlantis-fleet--placeholder-buffer-name (agent)
  "The read-only placeholder buffer name for AGENT."
  (format "*fleet: %s (no view)*" (atlantis-fleet-agent-name agent)))

(defun atlantis-fleet--placeholder-buffer (agent)
  "A read-only buffer holding AGENT's placeholder text, reused across shows."
  (let ((buffer (get-buffer-create (atlantis-fleet--placeholder-buffer-name agent))))
    (with-current-buffer buffer
      (let ((inhibit-read-only t))
        (erase-buffer)
        (insert (atlantis-fleet--placeholder agent)))
      (setq buffer-read-only t))
    buffer))

(defun atlantis-fleet--show-detail (agent)
  "Put AGENT's live session, or a placeholder, in the detail window.

Returns the buffer chosen.  AGENT's session buffer is used only when
its name is in `atlantis-fleet--owned' - an owned buffer that has not
actually been created yet (should not happen; `--owned' derives from
live buffers) falls back to the placeholder rather than erroring."
  (let ((buffer (if (member (atlantis-fleet-agent-name agent) (atlantis-fleet--owned))
                     (or (get-buffer (atlantis-fleet--session-buffer-name agent))
                         (atlantis-fleet--placeholder-buffer agent))
                   (atlantis-fleet--placeholder-buffer agent))))
    (when (and atlantis-fleet--detail-window (window-live-p atlantis-fleet--detail-window))
      (set-window-buffer atlantis-fleet--detail-window buffer))
    buffer))

;;; Launching and killing (ah-vcf.3)

;; vterm is a soft dependency (see `atlantis-fleet--launch'); these keep the
;; byte-compiler quiet about the symbols it only knows about once vterm is
;; actually loaded.
(defvar vterm-shell)
(declare-function vterm "vterm" (&optional buffer-name))

(defun atlantis-fleet--launch (agent)
  "Create AGENT's vterm session and return its buffer.

`vterm-shell' is let-bound rather than set globally, so the navigator's
ordinary vterm shells are unaffected."
  (unless (require 'vterm nil t)
    (user-error "atlantis-fleet needs vterm for live sessions - install emacs-libvterm"))
  (let* ((default-directory (atlantis-fleet--repo-root))
         (cmd (atlantis-fleet--launch-command agent))
         (vterm-shell (if (stringp cmd) cmd (mapconcat #'shell-quote-argument cmd " ")))
         (buffer (vterm (atlantis-fleet--session-buffer-name agent))))
    ;; The navigator's quit guard: confirm before Emacs or a buffer kill
    ;; takes a live agent down.  vterm's own kill behaviour is tuned for
    ;; disposable shells and does not set this on its own.
    (let ((proc (get-buffer-process buffer)))
      (when proc (set-process-query-on-exit-flag proc t)))
    (when (eq (atlantis-fleet-agent-kind agent) 'implementer)
      (message "%s started - it will idle until its go flag is set"
               (atlantis-fleet-agent-name agent)))
    buffer))

;;; The buffer

(defconst atlantis-fleet-buffer-name "*atlantis-fleet*")

(defvar atlantis-fleet--timer nil
  "The buffer-local auto-refresh timer, or nil.")
(make-variable-buffer-local 'atlantis-fleet--timer)

(defun atlantis-fleet--find-agent (name)
  "The `atlantis-fleet-agent' called NAME among `atlantis-fleet--agents'."
  (cl-find name atlantis-fleet--agents :key #'atlantis-fleet-agent-name :test #'equal))

(defun atlantis-fleet--agent-at-point ()
  "The agent on the current list line, or nil."
  (let ((id (tabulated-list-get-id)))
    (and id (atlantis-fleet--find-agent id))))

(defun atlantis-fleet--revert (&rest _)
  "Recompute `tabulated-list-entries' for the fleet buffer."
  (let* ((repo-root (atlantis-fleet--repo-root))
         (roster (atlantis-fleet--roster repo-root))
         (states (atlantis-fleet--gather-states repo-root roster))
         (args (atlantis-fleet--system-args))
         (owned (atlantis-fleet--owned))
         (now (current-time))
         (agents (atlantis-fleet--derive roster atlantis-fleet-interactive-agents states
                                          #'atlantis-fleet--pid-alive-p args owned)))
    (setq atlantis-fleet--agents agents)
    (setq tabulated-list-entries (mapcar (lambda (a) (atlantis-fleet--entry a now)) agents))))

(defun atlantis-fleet--cancel-timer ()
  "Stop this buffer's auto-refresh timer, if any."
  (when (timerp atlantis-fleet--timer)
    (cancel-timer atlantis-fleet--timer)
    (setq atlantis-fleet--timer nil)))

(defun atlantis-fleet--tick (buffer)
  "Refresh BUFFER if it is still alive; called every 5s while it lives."
  (when (buffer-live-p buffer)
    (with-current-buffer buffer
      (revert-buffer))))

(defun atlantis-fleet--follow ()
  "Show the selected agent's detail whenever the list selection changes.

Buffer-local on `post-command-hook', so it must stay cheap - compare
ids and return - since it runs after every command in the list buffer."
  (when (derived-mode-p 'atlantis-fleet-mode)
    (let ((id (tabulated-list-get-id)))
      (when (and id (not (equal id atlantis-fleet--last-shown)))
        (setq atlantis-fleet--last-shown id)
        (let ((agent (atlantis-fleet--find-agent id)))
          (when agent (atlantis-fleet--show-detail agent)))))))

(defun atlantis-fleet--setup-layout ()
  "Ensure the list/detail window layout exists for the current buffer."
  (unless (and atlantis-fleet--list-window (window-live-p atlantis-fleet--list-window))
    (delete-other-windows)
    (setq atlantis-fleet--list-window (selected-window))
    (setq atlantis-fleet--detail-window
          (split-window atlantis-fleet--list-window nil 'right))
    (let ((width (- 45 (window-width atlantis-fleet--list-window))))
      ;; A narrow frame/terminal can make 45 columns unsatisfiable;
      ;; `window-resize' signals in that case, and the list/detail split
      ;; above must still stand rather than leaving the buffer
      ;; half-initialized.
      (when (/= width 0)
        (ignore-errors (window-resize atlantis-fleet--list-window width t))))))

(defun atlantis-fleet-start ()
  "Start the agent at point (`s')."
  (interactive)
  (let ((agent (atlantis-fleet--agent-at-point)))
    (when agent
      (pcase (atlantis-fleet--start-action agent (atlantis-fleet--owned))
        ('launch
         (atlantis-fleet--launch agent)
         (revert-buffer)
         (atlantis-fleet--show-detail agent))
        ('already-up (message "%s is already up" (atlantis-fleet-agent-name agent)))
        ('external (message "%s is running outside Emacs" (atlantis-fleet-agent-name agent)))))))

(defun atlantis-fleet--kill-session-buffer (agent)
  "Kill AGENT's session buffer if it still exists, then refresh the view.

The buffer can have died between `--kill-action' deciding it was
killable (from a `--owned' snapshot) and this running - a real race,
not a hypothetical one - so a missing buffer is not an error here.

`atlantis-fleet-kill' has already confirmed this exact kill via
`y-or-n-p'; the process's query-on-exit flag exists to guard against an
*accidental* buffer/Emacs kill, not this intentional one, so it is
cleared first rather than prompting a second time for the same kill."
  (let ((buffer (get-buffer (atlantis-fleet--session-buffer-name agent))))
    (when buffer
      (let ((proc (get-buffer-process buffer)))
        (when proc (set-process-query-on-exit-flag proc nil)))
      (kill-buffer buffer)))
  (revert-buffer)
  (atlantis-fleet--show-detail agent))

(defun atlantis-fleet-kill ()
  "Kill the agent at point (`k'), confirming first."
  (interactive)
  (let ((agent (atlantis-fleet--agent-at-point)))
    (when agent
      (pcase (atlantis-fleet--kill-action agent (atlantis-fleet--owned))
        ('kill
         (when (y-or-n-p (format "Kill %s? " (atlantis-fleet-agent-name agent)))
           (atlantis-fleet--kill-session-buffer agent)))
        ('kill-working
         (when (y-or-n-p
                (format (concat "%s is working on %s - killing mid-bead strands a claim, "
                                 "a worktree and an open PR. Kill anyway? ")
                        (atlantis-fleet-agent-name agent) (atlantis-fleet-agent-bead agent)))
           (atlantis-fleet--kill-session-buffer agent)))
        ('external
         (message "%s is running outside Emacs - stop it from its own terminal"
                  (atlantis-fleet-agent-name agent)))
        ('dead (message "%s is not running" (atlantis-fleet-agent-name agent)))))))

(defun atlantis-fleet-focus-detail ()
  "Select the detail window (`RET'), to type to the agent shown there."
  (interactive)
  (when (window-live-p atlantis-fleet--detail-window)
    (select-window atlantis-fleet--detail-window)))

(defvar atlantis-fleet-mode-map
  (let ((map (make-sparse-keymap)))
    (set-keymap-parent map tabulated-list-mode-map)
    ;; special-mode's map does not bind n/p on its own; tabulated-list-mode
    ;; adds none either, so these are explicit.
    (define-key map "n" #'next-line)
    (define-key map "p" #'previous-line)
    (define-key map (kbd "RET") #'atlantis-fleet-focus-detail)
    (define-key map "s" #'atlantis-fleet-start)
    (define-key map "k" #'atlantis-fleet-kill)
    map)
  "Keymap for `atlantis-fleet-mode'.")

(define-derived-mode atlantis-fleet-mode tabulated-list-mode "Atlantis-Fleet"
  "Major mode listing the atlantis-hud agent fleet.

\\{atlantis-fleet-mode-map}"
  (setq tabulated-list-format
        [("Agent" 14 nil) ("Role" 13 nil) ("State" 18 nil) ("Bead" 10 nil) ("For" 6 nil)])
  (setq tabulated-list-padding 1)
  (setq tabulated-list-sort-key nil)
  (add-hook 'tabulated-list-revert-hook #'atlantis-fleet--revert nil t)
  (add-hook 'kill-buffer-hook #'atlantis-fleet--cancel-timer nil t)
  (add-hook 'post-command-hook #'atlantis-fleet--follow nil t)
  (tabulated-list-init-header))

;;;###autoload
(defun atlantis-fleet ()
  "Open (or refresh) the *atlantis-fleet* buffer, listing every agent."
  (interactive)
  (let ((buffer (get-buffer-create atlantis-fleet-buffer-name)))
    (with-current-buffer buffer
      (unless (derived-mode-p 'atlantis-fleet-mode)
        (atlantis-fleet-mode))
      (atlantis-fleet--revert)
      (tabulated-list-print t)
      (atlantis-fleet--cancel-timer)
      (setq atlantis-fleet--timer
            (run-with-timer 5 5 #'atlantis-fleet--tick buffer)))
    ;; `pop-to-buffer' must run before `--setup-layout': layout claims
    ;; `selected-window' as the list window, which is only correct once that
    ;; window is actually showing this buffer.
    (pop-to-buffer buffer)
    (with-current-buffer buffer
      (atlantis-fleet--setup-layout)
      (setq atlantis-fleet--last-shown nil)
      (atlantis-fleet--follow))))

(provide 'atlantis-fleet)
;;; atlantis-fleet.el ends here
