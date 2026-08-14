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

(defun atlantis-fleet--owned ()
  "Agent names whose sessions this Emacs itself started.

Always empty until ah-vcf.3, which is what actually starts and tracks them."
  nil)

;;; The buffer

(defconst atlantis-fleet-buffer-name "*atlantis-fleet*")

(defvar atlantis-fleet--timer nil
  "The buffer-local auto-refresh timer, or nil.")
(make-variable-buffer-local 'atlantis-fleet--timer)

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

(defvar atlantis-fleet-mode-map
  (let ((map (make-sparse-keymap)))
    (set-keymap-parent map tabulated-list-mode-map)
    ;; special-mode's map does not bind n/p on its own; tabulated-list-mode
    ;; adds none either, so these are explicit.
    (define-key map "n" #'next-line)
    (define-key map "p" #'previous-line)
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
    (pop-to-buffer buffer)))

(provide 'atlantis-fleet)
;;; atlantis-fleet.el ends here
