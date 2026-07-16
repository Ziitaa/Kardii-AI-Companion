#!/usr/bin/env python3
"""Build Kardii's transparent, normalized desktop-pet animations."""

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHEET = ROOT.parent / "upload" / "ChatGPT Image 2026年7月14日 17_00_53.png"
IDLE_SHEET = ROOT.parent / "generated_images" / "exec-e32e23d2-0f32-4795-bbed-139cda1f2aef.png"
OUTPUT = ROOT / "src" / "assets" / "pet"
FRAME_SIZE = (420, 340)


def remove_connected_white(image: Image.Image, threshold: int = 246) -> Image.Image:
    """Remove only near-white pixels connected to the crop boundary."""
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def is_background(x: int, y: int) -> bool:
        r, g, b, a = pixels[x, y]
        return a > 0 and min(r, g, b) >= threshold and max(r, g, b) - min(r, g, b) <= 8

    def push(x: int, y: int) -> None:
        if x < 0 or y < 0 or x >= width or y >= height:
            return
        index = y * width + x
        if seen[index] or not is_background(x, y):
            return
        seen[index] = 1
        queue.append((x, y))

    for x in range(width):
        push(x, 0)
        push(x, height - 1)
    for y in range(height):
        push(0, y)
        push(width - 1, y)

    while queue:
        x, y = queue.popleft()
        r, g, b, _ = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)
        push(x + 1, y)
        push(x - 1, y)
        push(x, y + 1)
        push(x, y - 1)

    return image


def normalize(image: Image.Image, max_size: tuple[int, int]) -> Image.Image:
    alpha = image.getchannel("A")
    bounds = alpha.getbbox()
    if not bounds:
        raise ValueError("Frame became empty after background removal")
    subject = image.crop(bounds)
    subject.thumbnail(max_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
    x = (FRAME_SIZE[0] - subject.width) // 2
    y = FRAME_SIZE[1] - subject.height - 8
    canvas.alpha_composite(subject, (x, y))
    return canvas


def equal_frames(sheet: Image.Image, count: int, row: tuple[int, int], span: tuple[int, int] | None = None):
    left, right = span or (0, sheet.width)
    top, bottom = row
    width = (right - left) / count
    for index in range(count):
        x0 = round(left + index * width)
        x1 = round(left + (index + 1) * width)
        yield sheet.crop((x0, top, x1, bottom))


def save_animation(
    name: str,
    frames: list[Image.Image],
    duration: int | list[int],
    save_frames: bool = True,
) -> None:
    folder = OUTPUT / "frames" / name
    folder.mkdir(parents=True, exist_ok=True)
    if save_frames:
        for index, frame in enumerate(frames):
            frame.save(folder / f"{index:02}.png", optimize=True)
    frames[0].save(
        OUTPUT / f"{name}.webp",
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        lossless=True,
        method=6,
    )


def normalize_sequence(
    frames: list[Image.Image],
    max_size: tuple[int, int] = (404, 324),
) -> list[Image.Image]:
    combined = Image.new("L", frames[0].size, 0)
    for frame in frames:
        combined = ImageChops.lighter(combined, frame.getchannel("A"))
    bounds = combined.getbbox()
    if not bounds:
        raise ValueError("Animation contains no visible pixels")

    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    scale = min(max_size[0] / width, max_size[1] / height)
    target = (max(1, round(width * scale)), max(1, round(height * scale)))
    normalized = []
    for frame in frames:
        subject = frame.crop(bounds).resize(target, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
        x = (FRAME_SIZE[0] - subject.width) // 2
        y = FRAME_SIZE[1] - subject.height - 8
        canvas.alpha_composite(subject, (x, y))
        normalized.append(canvas)
    return normalized


def build_original_states() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    original = Image.open(SOURCE_SHEET)
    idle = Image.open(IDLE_SHEET)

    specs = {
        "loading": (list(equal_frames(original, 6, (30, 305))), (380, 295), 180),
        "sleep": (list(equal_frames(original, 4, (315, 620), (0, 1340))), (380, 295), 420),
        "error": (list(equal_frames(original, 6, (620, 930))), (380, 310), 260),
        "idle": (list(equal_frames(idle, 6, (150, 690))), (340, 315), 240),
    }

    for name, (raw_frames, max_size, duration) in specs.items():
        frames = [normalize(remove_connected_white(frame), max_size) for frame in raw_frames]
        save_animation(name, frames, duration)
        print(f"built {name}: {len(frames)} frames")


def build_saved_states() -> None:
    specs = {
        "thinking": [420, 420, 420, 420, 480, 420],
        "talking": [280, 260, 260, 260, 320, 280],
        "happy": [300, 220, 180, 360, 200, 340],
    }
    for name, durations in specs.items():
        folder = OUTPUT / "frames" / name
        paths = sorted(folder.glob("*.png"))
        if len(paths) != len(durations):
            raise ValueError(f"{name} needs {len(durations)} frames, found {len(paths)}")
        frames = [Image.open(path).convert("RGBA") for path in paths]
        save_animation(name, normalize_sequence(frames), durations, save_frames=False)
        print(f"built {name}: {len(frames)} frames")


def build(saved_only: bool = False) -> None:
    if not saved_only:
        build_original_states()
    build_saved_states()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--saved-only",
        action="store_true",
        help="rebuild thinking, talking, and happy from their saved PNG frames",
    )
    args = parser.parse_args()
    build(saved_only=args.saved_only)
