"""
SnapSort Performance Benchmark Script
=====================================

This script tests the backend processing performance of SnapSort, measuring
how many images per second the machine learning pipeline can handle. The 
pipeline includes face detection (YuNet), face embedding (SFace), and 
semantic image embedding (CLIP).

Usage:
    1. Ensure you have the required Python dependencies installed:
       `pip install -r requirements.txt`
    2. Run the script and pass the directory of images you want to test:
       `python scripts/benchmark.py /path/to/your/images`

If no directory is provided, it will fallback to the current directory.
"""

import sys
import os
import time

# Ensure we can import the backend module from the project root
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend")))

from backend.controller import Controller

def run_benchmark(folder_path):
    print(f"Starting benchmark on folder: {folder_path}")
    start_time = time.time()
    
    # Initialize controller with 4 workers (default)
    controller = Controller(num_workers=4)
    
    # Trigger scan
    controller.scan_folder(folder_path)
    
    # Wait for scan to finish
    print("Scanning initiated. Waiting for processing to complete...")
    while controller.is_scanning or controller.pending_tasks > 0:
        elapsed = time.time() - start_time
        print(f"\rProcessed: {controller.processed_images}/{controller.total_images} | Pending: {controller.pending_tasks} | Elapsed: {elapsed:.2f}s", end="")
        time.sleep(1)
        
    end_time = time.time()
    total_time = end_time - start_time
    total_images = controller.processed_images
    
    print(f"\n\nBenchmark Complete!")
    print(f"Total time: {total_time:.2f} seconds")
    print(f"Total images processed: {total_images}")
    if total_time > 0:
        print(f"Throughput: {total_images / total_time:.2f} images/second")
    print(f"Average time per image: {total_time / total_images:.4f} seconds/image")
    
if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_folder = sys.argv[1]
    else:
        test_folder = "."
        
    if not os.path.exists(test_folder):
        print(f"Error: Path '{test_folder}' does not exist.")
        sys.exit(1)
        
    run_benchmark(test_folder)
