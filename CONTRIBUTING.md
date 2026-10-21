# Contributing to Deen Bridge Backend

Thank you for your interest in contributing to Deen Bridge! We welcome contributions from the community to help make Islamic education more accessible.

## Contribution Workflow

1. Find or open an issue describing the change.
2. Create a focused branch from `main` and implement the change.
3. Run the relevant checks described below.
4. Open a pull request against `main`, link the issue, and summarize the changes and checks.

Everyone is welcome to contribute to the platform's engineering work.

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- npm or yarn
- Git

### Setup

```bash
# Fork the repository
# Clone your fork
git clone git@github.com:YOUR_USERNAME/dnb-backend.git
cd dnb-backend

# Add upstream remote
git remote add upstream git@github.com:Deen-Bridge/dnb-backend.git

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your values

# Start development server
npm run dev
```

## Branching Strategy

| Branch | Purpose                                                        |
|--------|----------------------------------------------------------------|
| `main` | Active integration and production branch — pull requests target here |
| `dev`  | Legacy development branch; target only when a maintainer directs |

Changes merged to `main` may be deployed to production. Keep pull requests focused and ensure their required checks pass.

> **Always open PRs against `main`, not `dev`.** The auto-merge workflow only runs for PRs targeting `main`, and recent merged PRs all target `main`. CI workflows also run on `dev`, but a PR opened against `dev` will not be auto-merged.

### Branch Naming

Use a short, descriptive prefix: `feature/<name>`, `fix/<name>` (or `fix/issue-<number>`), `docs/<name>`, `chore/<name>`, `refactor/<name>`, `test/<name>`.

### Making Changes

1. Create a branch from the latest `main`:
   ```bash
   git fetch upstream
   git checkout -b feature/your-feature-name upstream/main
   ```

2. Make your changes following our coding standards

3. Test your changes:
   ```bash
   npm test
   ```

4. Commit with a descriptive message:
   ```bash
   git commit -m "feat: add transaction retry logic"
   ```

5. Push and create a PR **with `main` as the base branch**:
   ```bash
   git push origin feature/your-feature-name
   ```

## Coding Standards

### JavaScript/Node.js

- The backend is JavaScript using native ES modules (`"type": "module"` in `package.json`): use `import`/`export`, and include the `.js` extension in relative imports. Write new code in JavaScript. A number of existing `.ts` files live under `src/`, but the repo has no `tsconfig.json` or TypeScript build step, so do not rely on TypeScript tooling.
- Use ES6+ features
- Use async/await for asynchronous code
- Follow existing file structure
- Use descriptive variable and function names
- Handle errors properly with try/catch

### Input Validation

- Validate request input with [`express-validator`](https://express-validator.github.io/). Put reusable rule sets in `src/validators/` and run them through the `src/middlewares/validate.js` middleware, following the existing validators there.
- Do not introduce a different validation library without discussing it in an issue first.

### API Design

- Follow RESTful conventions
- Use appropriate HTTP status codes
- Return consistent response formats
- Document new endpoints

### Database

- Use Mongoose schemas for all models
- Add proper indexes for queries
- Validate input data
- Use transactions where appropriate

### Commits

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

When a PR conflicts with `main`, rebase your branch onto the latest `upstream/main` (`git fetch upstream && git rebase upstream/main`) and force-push with `--force-with-lease`. Do not merge `main` into your branch. Auto-merge skips PRs that have conflicts.

### Required Checks

Before opening a PR, run:

```bash
npm test
```

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm test`, a `node --check` syntax pass over every `.js` file, and a boot-and-`/health` smoke test. Changes under `contracts/` must also pass the Contracts CI (`cargo fmt --check`, `cargo clippy`, `cargo test`). There is currently no ESLint, Prettier, or coverage-threshold script, so none is required; match the style of the surrounding code. A mutation-testing workflow (Stryker) also runs on PRs.

### Pull Request Guidelines

1. **Base Branch**: open the PR against `main`
2. **Title**: Use conventional commit format
3. **Description**: Explain what and why
4. **Link Issue**: Include a closing reference such as `Closes #123`; the issue is closed as completed after merge
5. **Testing**: Describe how you tested
6. **API Changes**: Document any endpoint changes
7. **Auto-merge gates**: eligible, non-draft PRs are squash-merged when CI and all reported statuses pass, the branch has no conflicts, review requests and threads are resolved, and no `hold`, `do-not-merge`, or `manual-review` label is present. Contract changes must also pass Contracts CI.

### Labels

Maintainers apply labels; mention the one you think fits in your PR or issue.

- **Type**: `bug`, `chore`, `refactor`, `testing`, `ci`, `documentation`, `security`, `performance`, `database`
- **Complexity**: the issue's complexity label (for example low, medium, or high) indicates the size of the task; check the issue before picking it up.
- **Blocking**: `hold`, `do-not-merge`, and `manual-review` stop auto-merge.

## Issue Guidelines

### Reporting Bugs

Include:
- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- API endpoint affected
- Request/response samples
- Environment info

### Requesting Features

Include:
- Clear description of the feature
- Use case and motivation
- Proposed API design (if applicable)
- Database schema changes (if applicable)

## Security

- Never commit secrets or credentials
- Use environment variables for configuration
- Validate and sanitize all input
- Follow OWASP guidelines
- Report security issues privately

## Stellar Integration

When working on Stellar-related features:
- Test on testnet first
- Never log private keys or seeds
- Verify transactions on-chain
- Handle network errors gracefully
- Follow Stellar best practices

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Contributors of all backgrounds and faiths are welcome

## Questions?

- Open a GitHub Discussion
- Check existing issues and PRs
- Review the documentation

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
