# Contributing to Deen Bridge Backend

Thank you for your interest in contributing to Deen Bridge! We welcome contributions from the community to help make Islamic education more accessible.

## Drips Wave Program

This repository participates in the **Stellar Drips Wave** bounty program. Contributors can earn rewards by completing issues tagged with Wave labels.

### How It Works

1. **Find an Issue**: Look for issues with `wave:X` labels (where X is the point value)
2. **Claim the Issue**: Comment on the issue to express interest
3. **Submit a PR**: Complete the work and submit a pull request
4. **Earn Points**: Once merged, you earn points that translate to rewards

### Point Labels

| Label | Points | Typical Scope |
|-------|--------|---------------|
| `wave:1` | 1 point | Documentation, typos, small fixes |
| `wave:2` | 2 points | Bug fixes, minor features, API improvements |
| `wave:3` | 3 points | New features, significant improvements |
| `wave:4` | 4 points | Complex features, architectural changes |

### Wave Rules

- One contributor per issue (first come, first served)
- PRs must be linked to the issue
- **PRs must target the `dev` branch** (not `main`)
- Code must pass all tests
- Follow the coding standards below

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
| `main` | Stable, production-ready code — releases only                  |
| `dev`  | Active development — **all pull requests must target `dev`**   |

Maintainers periodically merge `dev` into `main` for releases. Pull requests opened against `main` will be asked to retarget `dev`.

### Making Changes

1. Create a branch from the latest `dev`:
   ```bash
   git fetch upstream
   git checkout -b feature/your-feature-name upstream/dev
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

5. Push and create a PR **with `dev` as the base branch**:
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

1. **Base Branch**: open the PR against `dev`, never `main`
2. **Title**: Use conventional commit format
3. **Description**: Explain what and why
4. **Link Issue**: Reference the issue number (`Closes #123`)
5. **Testing**: Describe how you tested
6. **API Changes**: Document any endpoint changes

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
- Follow Islamic principles of brotherhood

## Questions?

- Open a GitHub Discussion
- Check existing issues and PRs
- Review the documentation

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
