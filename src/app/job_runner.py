import argparse

from .db import init_db
from .main import _run_ocr_training_job, _run_training_job


def main() -> int:
    parser = argparse.ArgumentParser(description="OCR Crafter job runner")
    parser.add_argument("job_type", choices=["classification", "ocr"])
    parser.add_argument("job_id")
    args = parser.parse_args()

    init_db()
    if args.job_type == "ocr":
        _run_ocr_training_job(args.job_id)
        return 0
    _run_training_job(args.job_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
