# Highlight module ownership

The running service imports the JavaScript highlight controller, model, and
service. The matching TypeScript files are not runtime entry points. New
changes must target the JavaScript modules until the repository completes a
deliberate TypeScript migration; keeping one runtime implementation prevents
security fixes from diverging between duplicate files.
