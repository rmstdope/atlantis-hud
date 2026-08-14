# atlantis-fleet.el

An Emacs 28+ package that lists the atlantis-hud agent fleet: `M-x atlantis-fleet` (after adding
this directory to `load-path` and `(require 'atlantis-fleet)`) opens a self-refreshing buffer
showing every agent — Xavier, Cerebro, Moira and the fifteen implementers — with its state, and for
a working implementer the bead it is on and for how long. See `ah-vcf.2`'s bead for the full design;
`ah-vcf.3` adds the live detail window and starting/killing agents.

Run the tests with `pnpm run test:fleet`, or directly:

```bash
emacs --batch -L tools/emacs -l atlantis-fleet-test -f ert-run-tests-batch-and-exit
```

Not part of `pnpm run check` — the CI runners have no Emacs, and the gate must stay runnable there.
