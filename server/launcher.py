import uvicorn
import webbrowser
import threading
import time
import sys
import os

def open_browser():
    """Wait for the server to start and then open the browser."""
    # Give the server a moment to start
    time.sleep(2)
    url = "http://localhost:8000/static/index.html"
    print(f"Opening browser to {url}...")
    webbrowser.open(url)

if __name__ == "__main__":
    print("Starting Tesseract Studio...")
    
    # Start the browser thread
    threading.Thread(target=open_browser, daemon=True).start()
    
    # Run uvicorn
    # Note: We import app here to ensure get_resource_path is correctly initialized 
    # and all dependencies are loaded.
    from app import app
    
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
