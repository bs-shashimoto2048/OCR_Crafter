import argparse
import json

from .services.ocr_tuning import export_ocr_training_data


def main() -> None:
    parser = argparse.ArgumentParser(description="Export OCR training data for EasyOCR/PaddleOCR")
    parser.add_argument("--project-id", type=str, default="default")
    parser.add_argument("--engine", type=str, default="both", choices=["easyocr", "paddleocr", "both"])
    parser.add_argument("--output-dir", type=str, default="")
    parser.add_argument("--image-types", type=str, default="wide", help="comma separated: single,wide")
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument("--val-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    image_types = [x.strip() for x in args.image_types.split(",") if x.strip()]
    result = export_ocr_training_data(
        project_id=args.project_id,
        engine=args.engine,
        output_dir=(args.output_dir or None),
        image_types=image_types,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
        test_ratio=args.test_ratio,
        seed=args.seed,
        overwrite=bool(args.overwrite),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
