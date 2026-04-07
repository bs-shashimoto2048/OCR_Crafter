from PIL import Image


def classify_image_type(img: Image.Image, ratio_threshold: float = 2.0) -> str:
    w, h = img.size
    ratio = w / h if h > 0 else 1.0

    if ratio > ratio_threshold:
        return "wide"
    else:
        return "single"
