# Zcash Shielded Transaction Viewer - Makefile

# =============================================================================
# Default target
# =============================================================================

.PHONY: all
all: build ## Build the entire project

# =============================================================================
# Installation
# =============================================================================

.PHONY: install
install: install-wasm-pack install-backend install-prettier ## Install all dependencies
	@echo "All dependencies installed"

.PHONY: install-wasm-pack
install-wasm-pack: ## Install wasm-pack and Rust nightly toolchain
	@echo "Installing wasm-pack..."
	@which wasm-pack > /dev/null || cargo install wasm-pack
	@echo "Installing Rust nightly toolchain..."
	@rustup install nightly
	@rustup target add wasm32-unknown-unknown --toolchain nightly

.PHONY: install-backend
install-backend: ## Install Python dependencies with Poetry
	@echo "Installing Python dependencies with Poetry..."
	cd backend && poetry install

.PHONY: install-prettier
install-prettier: ## Install Prettier for JS/HTML formatting
	@echo "Installing Prettier..."
	npm install

# =============================================================================
# Building
# =============================================================================

.PHONY: build
build: build-wasm ## Build WASM module
	@echo "Build complete"

.PHONY: build-wasm
build-wasm: ## Build WASM module with wasm-pack
	@echo "Building WASM module..."
	cd wasm-module && wasm-pack build --target web --release --out-dir ../frontend/pkg

# =============================================================================
# Development
# =============================================================================

.PHONY: dev
dev: dev-backend ## Start development server (alias for dev-backend)

.PHONY: dev-backend
dev-backend: ## Start backend server with hot reload on port 8000
	@echo "Starting backend server..."
	cd backend && poetry run uvicorn main:app --reload --host 0.0.0.0 --port 8000

.PHONY: dev-frontend
dev-frontend: ## Serve frontend with Python HTTP server on port 3000
	@echo "Serving frontend on http://localhost:3000"
	cd frontend && python -m http.server 3000

.PHONY: dev-all
dev-all: ## Print instructions for running both servers
	@echo "Start backend with 'make dev-backend' and frontend with 'make dev-frontend' in separate terminals"

# =============================================================================
# Formatting
# =============================================================================

.PHONY: format
format: format-rust format-python format-js ## Format all code
	@echo "Formatting complete"

.PHONY: format-rust
format-rust: ## Format Rust code with cargo fmt
	@echo "Formatting Rust code..."
	cd wasm-module && cargo +nightly fmt

.PHONY: format-python
format-python: ## Format Python code with Ruff
	@echo "Formatting Python code with Ruff..."
	cd backend && poetry run ruff format .

.PHONY: format-js
format-js: ## Format JavaScript/HTML with Prettier
	@echo "Formatting JavaScript/HTML files..."
	npx prettier --write "frontend/**/*.{js,html,css,json}"

# =============================================================================
# Linting
# =============================================================================

.PHONY: lint
lint: lint-rust lint-python lint-js ## Lint all code
	@echo "Linting complete"

.PHONY: lint-rust
lint-rust: ## Lint Rust code with clippy
	@echo "Linting Rust code..."
	cd wasm-module && cargo +nightly clippy -- -D warnings

.PHONY: lint-python
lint-python: ## Lint Python code with Ruff
	@echo "Linting Python code with Ruff..."
	cd backend && poetry run ruff check .

.PHONY: lint-js
lint-js: ## Check JavaScript/HTML formatting with Prettier
	@echo "Checking JavaScript/HTML formatting..."
	npx prettier --check "frontend/**/*.{js,html,css,json}"

# =============================================================================
# Testing
# =============================================================================

.PHONY: test
test: test-rust test-backend ## Run all tests
	@echo "All tests passed"

.PHONY: test-rust
test-rust: ## Run Rust unit tests
	@echo "Running Rust tests..."
	cd wasm-module && cargo +nightly test

.PHONY: test-wasm
test-wasm: ## Run WASM tests in headless browser
	@echo "Running WASM tests..."
	cd wasm-module && wasm-pack test --headless --firefox

.PHONY: test-backend
test-backend: ## Run Python tests with pytest
	@echo "Running backend tests..."
	cd backend && poetry run pytest

# =============================================================================
# Cleaning
# =============================================================================

.PHONY: clean
clean: clean-wasm clean-node clean-backend ## Clean all build artifacts
	@echo "Clean complete"

.PHONY: clean-wasm
clean-wasm: ## Clean WASM build artifacts
	@echo "Cleaning WASM build artifacts..."
	rm -rf wasm-module/target
	rm -rf frontend/pkg

.PHONY: clean-node
clean-node: ## Clean node_modules
	@echo "Cleaning Node modules..."
	rm -rf node_modules

.PHONY: clean-backend
clean-backend: ## Clean Python cache files
	@echo "Cleaning Python cache..."
	find backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find backend -type f -name "*.pyc" -delete 2>/dev/null || true

# =============================================================================
# Production
# =============================================================================

.PHONY: prod-build
prod-build: build ## Build for production
	@echo "Production build complete"

.PHONY: prod-serve
prod-serve: ## Start production server
	@echo "Starting production server..."
	cd backend && poetry run uvicorn main:app --host 0.0.0.0 --port 8000

# =============================================================================
# Help
# =============================================================================

.PHONY: help
help: ## Show this help message
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
