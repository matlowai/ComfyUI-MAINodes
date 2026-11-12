"""Make pytest able to collect from inside a ComfyUI custom node pack.

The pack root is itself a Python package (`__init__.py` with relative
imports, loaded by ComfyUI as `custom_nodes.<pack>`). pytest 8+ turns any
ancestor directory that has an `__init__.py` into a Package node and
imports that file at setup, as a TOP LEVEL module named `__init__`, where
the relative imports cannot resolve:

    ImportError: attempted relative import with no known parent package

Registering a placeholder under that name first makes pytest's import_path
return it instead of executing the file. Nothing in these tests uses it;
they import the flow package explicitly from the repo root.
"""
import sys
import types

sys.modules.setdefault("__init__", types.ModuleType("__init__"))
