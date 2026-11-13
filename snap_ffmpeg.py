"""ffmpeg as Snap runs it: at low priority where the system has `nice`, and with a plain sentence when it isn't installed.

ComfyUI itself reads and writes video through PyAV, so an install can work with no ffmpeg program on PATH (the Windows
portable build ships none). Snap's sound measuring, "make it louder", voice clips, the Cut and the no-metadata save run
the program; without it they say so instead of raising "[WinError 2] The system cannot find the file specified"."""
import os
import shutil

NICE = ["nice", "-n", "10"] if os.name != "nt" and shutil.which("nice") else []


class Missing(FileNotFoundError):
    pass


def need(tool="ffmpeg"):
    if shutil.which(tool) is None:
        raise Missing(f"This needs {tool}, and it isn't on this computer's PATH. Install ffmpeg (https://ffmpeg.org/download.html; on Windows: "
                      "winget install ffmpeg), restart ComfyUI and run this again.")
