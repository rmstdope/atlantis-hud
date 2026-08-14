;;; atlantis-fleet-test.el --- Tests for atlantis-fleet.el -*- lexical-binding: t; -*-

;; Run with: pnpm run test:fleet
;; (emacs --batch -L tools/emacs -l atlantis-fleet-test -f ert-run-tests-batch-and-exit)

(require 'ert)
(require 'atlantis-fleet)

;; ---------------------------------------------------------------------------
;; Increment 1: the pure derivation

(defconst atlantis-fleet-test--interactive
  '(("Xavier" . "planner")
    ("Cerebro" . "orchestrator")
    ("Moira" . "feedback")))

(defun atlantis-fleet-test--always-alive (_pid) t)
(defun atlantis-fleet-test--never-alive (_pid) nil)

(ert-deftest atlantis-fleet-test/derive-implementer-working-from-live-state-file ()
  (let* ((states '(("Cyclops" . ((state . "working") (bead . "ah-f9c")
                                  (since . "2026-08-14T09:00:00Z") (pid . 4242)))))
         (agents (atlantis-fleet--derive '("Cyclops") nil states
                                          #'atlantis-fleet-test--always-alive nil nil))
         (agent (car agents)))
    (should (eq (atlantis-fleet-agent-state agent) 'working))
    (should (equal (atlantis-fleet-agent-bead agent) "ah-f9c"))
    (should (equal (atlantis-fleet-agent-since agent) "2026-08-14T09:00:00Z"))))

(ert-deftest atlantis-fleet-test/derive-implementer-idle-between-beads ()
  (let* ((states '(("Wolverine" . ((state . "idle") (bead . nil)
                                    (since . "2026-08-14T09:00:00Z") (pid . 4343)))))
         (agents (atlantis-fleet--derive '("Wolverine") nil states
                                          #'atlantis-fleet-test--always-alive nil nil))
         (agent (car agents)))
    (should (eq (atlantis-fleet-agent-state agent) 'idle))
    (should (null (atlantis-fleet-agent-bead agent)))))

(ert-deftest atlantis-fleet-test/derive-implementer-dead-when-pid-gone ()
  (let* ((states '(("Storm" . ((state . "working") (bead . "ah-abc")
                                (since . "2026-08-14T09:00:00Z") (pid . 9999)))))
         (agents (atlantis-fleet--derive '("Storm") nil states
                                          #'atlantis-fleet-test--never-alive nil nil))
         (agent (car agents)))
    (should (eq (atlantis-fleet-agent-state agent) 'dead))
    (should (null (atlantis-fleet-agent-bead agent)))))

(ert-deftest atlantis-fleet-test/derive-implementer-dead-when-file-missing ()
  (let* ((states '(("Rogue" . nil)))
         (agents (atlantis-fleet--derive '("Rogue") nil states
                                          #'atlantis-fleet-test--always-alive nil nil))
         (agent (car agents)))
    (should (eq (atlantis-fleet-agent-state agent) 'dead))))

(ert-deftest atlantis-fleet-test/derive-implementer-external-when-not-owned ()
  (let* ((states '(("Gambit" . ((state . "working") (bead . "ah-xyz")
                                 (since . "2026-08-14T09:00:00Z") (pid . 111)))))
         (agents (atlantis-fleet--derive '("Gambit") nil states
                                          #'atlantis-fleet-test--always-alive nil nil))
         (agent (car agents)))
    (should (atlantis-fleet-agent-external agent))))

(ert-deftest atlantis-fleet-test/derive-implementer-not-external-when-owned ()
  (let* ((states '(("Gambit" . ((state . "working") (bead . "ah-xyz")
                                 (since . "2026-08-14T09:00:00Z") (pid . 111)))))
         (agents (atlantis-fleet--derive '("Gambit") nil states
                                          #'atlantis-fleet-test--always-alive nil '("Gambit")))
         (agent (car agents)))
    (should-not (atlantis-fleet-agent-external agent))))

(ert-deftest atlantis-fleet-test/derive-interactive-up-from-process-args ()
  (let* ((args '("claude --agent planner --name Xavier --print"))
         (agents (atlantis-fleet--derive nil atlantis-fleet-test--interactive nil
                                          #'atlantis-fleet-test--never-alive args nil))
         (xavier (car agents)))
    (should (eq (atlantis-fleet-agent-state xavier) 'up))
    (should (atlantis-fleet-agent-external xavier))))

(ert-deftest atlantis-fleet-test/derive-interactive-up-when-owned ()
  (let* ((agents (atlantis-fleet--derive nil atlantis-fleet-test--interactive nil
                                          #'atlantis-fleet-test--never-alive nil '("Xavier")))
         (xavier (car agents)))
    (should (eq (atlantis-fleet-agent-state xavier) 'up))
    (should-not (atlantis-fleet-agent-external xavier))))

(ert-deftest atlantis-fleet-test/derive-interactive-dead-when-absent ()
  (let* ((agents (atlantis-fleet--derive nil atlantis-fleet-test--interactive nil
                                          #'atlantis-fleet-test--never-alive nil nil))
         (moira (nth 2 agents)))
    (should (equal (atlantis-fleet-agent-name moira) "Moira"))
    (should (eq (atlantis-fleet-agent-state moira) 'dead))))

(ert-deftest atlantis-fleet-test/derive-order-interactive-first-then-roster ()
  (let* ((agents (atlantis-fleet--derive '("Cyclops" "Storm") atlantis-fleet-test--interactive nil
                                          #'atlantis-fleet-test--never-alive nil nil)))
    (should (equal (mapcar #'atlantis-fleet-agent-name agents)
                    '("Xavier" "Cerebro" "Moira" "Cyclops" "Storm")))))

;; ---------------------------------------------------------------------------
;; Increment 2: formatting

(ert-deftest atlantis-fleet-test/entry-working-implementer-shows-bead-and-elapsed ()
  (let* ((now (encode-time (iso8601-parse "2026-08-14T09:12:00Z")))
         (agent (make-atlantis-fleet-agent :name "Cyclops" :role "implementer" :kind 'implementer
                                            :state 'working :bead "ah-f9c"
                                            :since "2026-08-14T09:00:00Z" :external nil))
         (entry (atlantis-fleet--entry agent now))
         (row (nth 1 entry)))
    (should (equal (aref row 3) "ah-f9c"))
    (should (equal (aref row 4) "12m"))))

(ert-deftest atlantis-fleet-test/entry-external-marked ()
  (let* ((now (encode-time (iso8601-parse "2026-08-14T09:12:00Z")))
         (agent (make-atlantis-fleet-agent :name "Storm" :role "implementer" :kind 'implementer
                                            :state 'working :bead "ah-f9c"
                                            :since "2026-08-14T09:00:00Z" :external t))
         (entry (atlantis-fleet--entry agent now))
         (row (nth 1 entry)))
    (should (equal (aref row 3) "(external)"))
    (should (equal (aref row 4) ""))))

(ert-deftest atlantis-fleet-test/entry-dead-has-empty-bead-column ()
  (let* ((now (encode-time (iso8601-parse "2026-08-14T09:12:00Z")))
         (agent (make-atlantis-fleet-agent :name "Rogue" :role "implementer" :kind 'implementer
                                            :state 'dead :bead nil :since nil :external nil))
         (entry (atlantis-fleet--entry agent now))
         (row (nth 1 entry)))
    (should (equal (aref row 3) ""))
    (should (equal (aref row 4) ""))))

(ert-deftest atlantis-fleet-test/elapsed-minutes-hours-days ()
  (let ((now (encode-time (iso8601-parse "2026-08-14T09:12:00Z"))))
    (should (equal (atlantis-fleet--elapsed "2026-08-14T09:00:00Z" now) "12m"))
    (should (equal (atlantis-fleet--elapsed "2026-08-14T08:09:00Z" now) "1h03"))
    (should (equal (atlantis-fleet--elapsed "2026-08-12T09:12:00Z" now) "2d"))))

(ert-deftest atlantis-fleet-test/elapsed-nil-since-is-empty ()
  (should (equal (atlantis-fleet--elapsed nil (current-time)) "")))

;; ---------------------------------------------------------------------------
;; Increment 3: the buffer

(ert-deftest atlantis-fleet-test/buffer-lists-every-agent-once ()
  (cl-letf (((symbol-function 'atlantis-fleet--repo-root) (lambda () "/fake/repo"))
            ((symbol-function 'atlantis-fleet--roster)
             (lambda (_repo-root) (mapcar #'car atlantis-fleet-roster-fixture)))
            ((symbol-function 'atlantis-fleet--gather-states)
             (lambda (_repo-root _roster) nil))
            ((symbol-function 'atlantis-fleet--system-args) (lambda () nil))
            ((symbol-function 'atlantis-fleet--owned) (lambda () nil)))
    (unwind-protect
        (progn
          (atlantis-fleet)
          (with-current-buffer atlantis-fleet-buffer-name
            (should (= (length tabulated-list-entries) 18))
            (should (equal (length (delete-dups (mapcar #'car tabulated-list-entries))) 18))))
      (when (get-buffer atlantis-fleet-buffer-name)
        (kill-buffer atlantis-fleet-buffer-name)))))

(defconst atlantis-fleet-roster-fixture
  (mapcar (lambda (n) (cons n nil))
          '("Cyclops" "Storm" "Wolverine" "Rogue" "Gambit" "Nightcrawler" "Colossus"
            "Iceman" "Beast" "Jubilee" "Psylocke" "Bishop" "Phoenix" "Mystique" "Magneto")))

;; ---------------------------------------------------------------------------
;; Increment 4: roster parsing

(ert-deftest atlantis-fleet-test/roster-parses-lines ()
  (should (equal (atlantis-fleet--parse-roster "Cyclops\nStorm\nWolverine\n")
                  '("Cyclops" "Storm" "Wolverine"))))

(ert-deftest atlantis-fleet-test/roster-parses-lines-ignoring-blank ()
  (should (equal (atlantis-fleet--parse-roster "Cyclops\n\nStorm\n\n")
                  '("Cyclops" "Storm"))))

;; ---------------------------------------------------------------------------
;; ah-vcf.3 increment 1: the pure decisions

(defun atlantis-fleet-test--agent (name role kind state &optional external bead)
  (make-atlantis-fleet-agent :name name :role role :kind kind :state state
                              :bead bead :since nil :external external))

(ert-deftest atlantis-fleet-test/launch-command-each-interactive-launcher ()
  (should (equal (atlantis-fleet--launch-command
                   (atlantis-fleet-test--agent "Xavier" "planner" 'interactive 'dead))
                  "scripts/run-planner"))
  (should (equal (atlantis-fleet--launch-command
                   (atlantis-fleet-test--agent "Cerebro" "orchestrator" 'interactive 'dead))
                  "scripts/run-orchestrator"))
  (should (equal (atlantis-fleet--launch-command
                   (atlantis-fleet-test--agent "Moira" "feedback" 'interactive 'dead))
                  "scripts/run-user-feedback")))

(ert-deftest atlantis-fleet-test/launch-command-implementer-takes-its-name ()
  (should (equal (atlantis-fleet--launch-command
                   (atlantis-fleet-test--agent "Cyclops" "implementer" 'implementer 'dead))
                  '("scripts/run-implementer" "Cyclops"))))

(ert-deftest atlantis-fleet-test/session-buffer-name-shape ()
  (should (equal (atlantis-fleet--session-buffer-name
                   (atlantis-fleet-test--agent "Cyclops" "implementer" 'implementer 'dead))
                  "*fleet: Cyclops*")))

(ert-deftest atlantis-fleet-test/start-action-launches-dead ()
  (should (eq (atlantis-fleet--start-action
                (atlantis-fleet-test--agent "Cyclops" "implementer" 'implementer 'dead) nil)
              'launch)))

(ert-deftest atlantis-fleet-test/start-action-refuses-external ()
  (should (eq (atlantis-fleet--start-action
                (atlantis-fleet-test--agent "Xavier" "planner" 'interactive 'up t) nil)
              'external)))

(ert-deftest atlantis-fleet-test/start-action-already-up ()
  (should (eq (atlantis-fleet--start-action
                (atlantis-fleet-test--agent "Xavier" "planner" 'interactive 'up nil)
                '("Xavier"))
              'already-up)))

(ert-deftest atlantis-fleet-test/kill-action-plain-kill-for-idle ()
  (should (eq (atlantis-fleet--kill-action
                (atlantis-fleet-test--agent "Wolverine" "implementer" 'implementer 'idle nil)
                '("Wolverine"))
              'kill)))

(ert-deftest atlantis-fleet-test/kill-action-harder-for-working ()
  (should (eq (atlantis-fleet--kill-action
                (atlantis-fleet-test--agent "Cyclops" "implementer" 'implementer 'working nil "ah-f9c")
                '("Cyclops"))
              'kill-working)))

(ert-deftest atlantis-fleet-test/kill-action-external-and-dead-refused ()
  (should (eq (atlantis-fleet--kill-action
                (atlantis-fleet-test--agent "Xavier" "planner" 'interactive 'up t) nil)
              'external))
  (should (eq (atlantis-fleet--kill-action
                (atlantis-fleet-test--agent "Rogue" "implementer" 'implementer 'dead nil) nil)
              'dead)))

(ert-deftest atlantis-fleet-test/placeholder-external-vs-dead-wording ()
  (should (equal (atlantis-fleet--placeholder
                   (atlantis-fleet-test--agent "Cyclops" "implementer" 'implementer 'dead))
                  "Cyclops is not running. Press s to start it."))
  (should (equal (atlantis-fleet--placeholder
                   (atlantis-fleet-test--agent "Xavier" "planner" 'interactive 'up t))
                  (concat "Xavier is running outside Emacs - no live view. "
                          "Use the terminal that started it."))))

;; ---------------------------------------------------------------------------
;; ah-vcf.3 increment 2: owned sessions feed the list

;; The seam this bead fills: a non-empty OWNED turns an interactive agent
;; `up' and un-externals it.  Already true of ah-vcf.2's --derive; pinned
;; here so a later change to the derivation cannot silently break the seam.
(ert-deftest atlantis-fleet-test/derive-owned-interactive-is-up-not-external ()
  (let* ((agents (atlantis-fleet--derive nil atlantis-fleet-test--interactive nil
                                          #'atlantis-fleet-test--never-alive nil '("Xavier")))
         (xavier (car agents)))
    (should (eq (atlantis-fleet-agent-state xavier) 'up))
    (should-not (atlantis-fleet-agent-external xavier))))

(ert-deftest atlantis-fleet-test/owned-buffer-agent-name-matches-session-scheme ()
  (should (equal (atlantis-fleet--owned-buffer-agent-name "*fleet: Cyclops*") "Cyclops"))
  (should (equal (atlantis-fleet--owned-buffer-agent-name "*fleet: Xavier*") "Xavier")))

(ert-deftest atlantis-fleet-test/owned-buffer-agent-name-no-match ()
  (should (null (atlantis-fleet--owned-buffer-agent-name "*scratch*")))
  (should (null (atlantis-fleet--owned-buffer-agent-name "*fleet: Cyclops (no view)*"))))

;; ---------------------------------------------------------------------------
;; ah-vcf.3 increment 3: windows and keys

(ert-deftest atlantis-fleet-test/show-detail-picks-session-when-owned-else-placeholder ()
  (let* ((owned-agent (atlantis-fleet-test--agent "Cyclops" "implementer" 'implementer 'working
                                                    nil "ah-f9c"))
         (dead-agent (atlantis-fleet-test--agent "Rogue" "implementer" 'implementer 'dead))
         (session-name (atlantis-fleet--session-buffer-name owned-agent))
         (placeholder-name "*fleet: Rogue (no view)*"))
    (unwind-protect
        (progn
          (get-buffer-create session-name)
          (cl-letf (((symbol-function 'atlantis-fleet--owned) (lambda () '("Cyclops"))))
            (should (eq (atlantis-fleet--show-detail owned-agent) (get-buffer session-name)))
            (let ((placeholder (atlantis-fleet--show-detail dead-agent)))
              (should (equal (buffer-name placeholder) placeholder-name))
              (should (equal (with-current-buffer placeholder (buffer-string))
                              (atlantis-fleet--placeholder dead-agent))))))
      (dolist (name (list session-name placeholder-name))
        (when (get-buffer name) (kill-buffer name))))))

(provide 'atlantis-fleet-test)
;;; atlantis-fleet-test.el ends here
