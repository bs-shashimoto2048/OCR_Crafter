import argparse
import json
from pathlib import Path

from .services.ocr_pipeline import migrate_ocr_models_to_inference


def main() -> None:
    default_repo = str((Path(__file__).resolve().parents[2] / "external" / "PaddleOCR").resolve())
    parser = argparse.ArgumentParser(description="Migrate OCR model metadata to inference-exported model dirs")
    parser.add_argument("--project-id", type=str, default="default")
    parser.add_argument("--paddle-repo-dir", type=str, default=default_repo)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = migrate_ocr_models_to_inference(
        project_id=args.project_id,
        paddle_repo_dir=args.paddle_repo_dir,
        overwrite=bool(args.overwrite),
        dry_run=bool(args.dry_run),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
