# TypeScript migration cleanup

After each migration decision, remove the superseded duplicate JavaScript or TypeScript module and update imports. CI should fail on duplicate module paths so stale implementations cannot diverge.
