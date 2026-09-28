# Development Workflow Guide: Husky, Prettier & Linting

This project uses **Husky**, **Prettier**, and **ESLint** to ensure consistent code style and quality across the codebase.

## 🚀 Key Features

- **Automated Formatting**: Code is automatically formatted using Prettier.
- **Pre-commit Hooks**: Husky runs linting and formatting checks before every commit.
- **Staged-only Checks**: Only changed files are checked, making the process fast.

---

## 🛠 Setup

Ensure you have installed the dependencies:

```bash
npm install
```

The `prepare` script in `package.json` will automatically initialize Husky.

---

## 📖 How to Use

### 1. Manual Formatting
To format the entire codebase manually:
```bash
npm run format
```

### 2. Manual Linting
To check for linting issues:
```bash
npm run lint
```
To fix auto-fixable linting issues:
```bash
npm run lint:fix
```

### 3. Automatic Pre-commit Hook
When you run `git commit`, the following happens automatically:
1. **Linting**: Runs `eslint --fix` on your staged `.ts` files.
2. **Formatting**: Runs `prettier --write` on your staged `.ts` files.
3. **Re-staging**: If any files were modified by the above steps, they are automatically re-staged.

---

## ❌ Troubleshooting Commit Failures

If your commit fails, check the terminal output.

### 1. Linting Errors
If there are non-fixable linting errors (e.g., `Unexpected any`), you must fix them manually before you can commit.
- **Action**: Look at the error message, go to the file/line indicated, and fix the issue.

### 2. Husky Not Running
If Husky doesn't seem to run on commit:
- **Action**: Run `npm run prepare` to re-initialize Husky.

### 3. Bypassing Hooks (Not Recommended)
If you absolutely must bypass the hooks (e.g., for a quick WIP commit):
```bash
git commit -m "your message" --no-verify
```
*Note: This should be avoided in favor of fixing the issues.*

---

## ⚙️ Configuration Files

- `.prettierrc`: Prettier formatting rules.
- `.prettierignore`: Files/folders ignored by Prettier.
- `eslint.config.ts`: ESLint configuration.
- `.husky/pre-commit`: Husky hook definition.
- `package.json`: Contains `lint-staged` configuration.
