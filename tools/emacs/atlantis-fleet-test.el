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

(provide 'atlantis-fleet-test)
;;; atlantis-fleet-test.el ends here
