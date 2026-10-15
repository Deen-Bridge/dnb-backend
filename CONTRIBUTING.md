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

- Use ES6+ features
- Use async/await for asynchronous code
- Follow existing file structure
- Use descriptive variable and function names
- Handle errors properly with try/catch

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

### Pull Request Guidelines

1. **Base Branch**: open the PR against `main`
2. **Title**: Use conventional commit format
3. **Description**: Explain what and why
4. **Link Issue**: Include a closing reference such as `Closes #123`; the issue is closed as completed after merge
5. **Testing**: Describe how you tested
6. **API Changes**: Document any endpoint changes
7. **Auto-merge gates**: eligible, non-draft PRs are squash-merged when CI and all reported statuses pass, the branch has no conflicts, review requests and threads are resolved, and no `hold`, `do-not-merge`, or `manual-review` label is present. Contract changes must also pass Contracts CI.

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
