# atlantis-fleet.el

An Emacs 28+ package that lists the atlantis-hud agent fleet: `M-x atlantis-fleet` (after adding
this directory to `load-path` and `(require 'atlantis-fleet)`) opens a self-refreshing buffer
showing every agent — Xavier, Cerebro, Moira and the fifteen implementers — with its state, and for
a working implementer the bead it is on and for how long. See `ah-vcf.2`'s bead for the list design.

`ah-vcf.3` adds the live detail window that follows the list selection, and starting/killing agents
from the list: `s` starts a dead agent (into an Emacs-owned `vterm` buffer running its launcher),
`k` kills a live one (confirming harder mid-bead), `RET` selects the detail window to type to the
agent shown there. An agent running outside Emacs is shown and marked but not viewable — a
placeholder says so. This needs **vterm** (`emacs-libvterm`); without it the list still works, and
`s`/`RET` signal a clear error instead of failing obscurely.

Run the tests with `pnpm run test:fleet`, or directly:

```bash
emacs --batch -L tools/emacs -l atlantis-fleet-test -f ert-run-tests-batch-and-exit
```

Not part of `pnpm run check` — the CI runners have no Emacs, and the gate must stay runnable there.
