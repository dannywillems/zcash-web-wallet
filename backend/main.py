"""
Zcash Shielded Transaction Viewer - Backend API

A minimal FastAPI backend that proxies requests to a Zcash full node.
"""

import os
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(
    title="Zcash Transaction Viewer API",
    description="API for fetching raw Zcash transactions",
    version="0.1.0",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration from environment variables
ZCASH_RPC_HOST = os.getenv("ZCASH_RPC_HOST", "127.0.0.1")
ZCASH_RPC_PORT = os.getenv("ZCASH_RPC_PORT", "8232")
ZCASH_RPC_USER = os.getenv("ZCASH_RPC_USER", "")
ZCASH_RPC_PASSWORD = os.getenv("ZCASH_RPC_PASSWORD", "")

# Testnet configuration
ZCASH_TESTNET_RPC_HOST = os.getenv("ZCASH_TESTNET_RPC_HOST", "127.0.0.1")
ZCASH_TESTNET_RPC_PORT = os.getenv("ZCASH_TESTNET_RPC_PORT", "18232")
ZCASH_TESTNET_RPC_USER = os.getenv("ZCASH_TESTNET_RPC_USER", "")
ZCASH_TESTNET_RPC_PASSWORD = os.getenv("ZCASH_TESTNET_RPC_PASSWORD", "")


class TransactionResponse(BaseModel):
    """Response model for transaction data"""

    txid: str
    hex: str


class RPCRequest(BaseModel):
    """JSON-RPC request model"""

    jsonrpc: str = "1.0"
    id: str = "zcash-viewer"
    method: str
    params: list


async def call_zcash_rpc(
    method: str,
    params: list,
    network: str = "mainnet",
) -> dict:
    """Make a JSON-RPC call to the Zcash node"""
    if network == "testnet":
        host = ZCASH_TESTNET_RPC_HOST
        port = ZCASH_TESTNET_RPC_PORT
        user = ZCASH_TESTNET_RPC_USER
        password = ZCASH_TESTNET_RPC_PASSWORD
    else:
        host = ZCASH_RPC_HOST
        port = ZCASH_RPC_PORT
        user = ZCASH_RPC_USER
        password = ZCASH_RPC_PASSWORD

    url = f"http://{host}:{port}"

    request = RPCRequest(method=method, params=params)

    async with httpx.AsyncClient() as client:
        try:
            auth = (user, password) if user and password else None
            response = await client.post(
                url,
                json=request.model_dump(),
                auth=auth,
                timeout=30.0,
            )
            response.raise_for_status()
            result = response.json()

            if "error" in result and result["error"] is not None:
                raise HTTPException(
                    status_code=400,
                    detail=result["error"].get("message", "RPC error"),
                )

            return result.get("result")
        except httpx.ConnectError:
            raise HTTPException(
                status_code=503,
                detail="Cannot connect to Zcash node. Is zcashd running?",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="Zcash node request timed out",
            )
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Zcash node error: {e.response.text}",
            )


@app.get("/api/transaction/{txid}", response_model=TransactionResponse)
async def get_transaction(
    txid: str,
    network: str = Query("mainnet", regex="^(mainnet|testnet)$"),
) -> TransactionResponse:
    """
    Fetch a raw transaction by its ID.

    - **txid**: The transaction hash (64 hex characters)
    - **network**: The network to query (mainnet or testnet)

    Returns the raw transaction hex which can be decoded client-side.
    """
    # Validate txid format
    if len(txid) != 64 or not all(c in "0123456789abcdefABCDEF" for c in txid):
        raise HTTPException(
            status_code=400,
            detail="Invalid transaction ID format. Expected 64 hex characters.",
        )

    # Get raw transaction with verbose=0 to get hex
    raw_tx = await call_zcash_rpc("getrawtransaction", [txid, 0], network)

    if raw_tx is None:
        raise HTTPException(
            status_code=404,
            detail="Transaction not found",
        )

    return TransactionResponse(txid=txid, hex=raw_tx)


@app.get("/api/health")
async def health_check() -> dict:
    """Health check endpoint"""
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/node-info")
async def node_info(
    network: str = Query("mainnet", regex="^(mainnet|testnet)$"),
) -> dict:
    """Get information about the connected Zcash node"""
    try:
        info = await call_zcash_rpc("getinfo", [], network)
        blockchain_info = await call_zcash_rpc("getblockchaininfo", [], network)
        return {
            "connected": True,
            "version": info.get("version"),
            "blocks": blockchain_info.get("blocks"),
            "chain": blockchain_info.get("chain"),
        }
    except HTTPException:
        return {"connected": False}


# Mount static files for frontend (in production)
# This should be last to not override API routes
try:
    app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
except RuntimeError:
    pass  # Static files directory may not exist in development


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
