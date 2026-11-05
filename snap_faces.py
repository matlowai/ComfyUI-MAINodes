"""Snap's identity notes on edit candidates (U56, U56b): did an edit keep the person? Two measurements per picture, the
page compares them against the take's own frames with thresholds from the model graph:
- the face: an ArcFace embedding (IResNet-101, CVLface WebFace4M safetensors in models/face_recognition) of a square
  crop around SAM 3.1's face mask. U56: a different woman scores 0.25-0.45 against her, the same woman 0.34-0.80, so a
  low score says "probably a different person" and nothing more; hair colour is invisible to it.
- the hair: the lightness of the lit part of SAM 3.1's hair mask (L* 90th percentile). U56b: grey and silver edits
  rise +14 to +41 over the original take's frames, kept ones stay at or below +9; blonder drift doesn't show.
Notes only: the head crops on the candidate decide (SNAP-R23).
IRBlock and IResNet101 follow the IResNet of insightface's arcface_torch (github.com/deepinsight/insightface, code MIT),
in the key layout CVLface (github.com/mk-minchul/CVLface, MIT) saves; no weights ship here (docs/snap/README.md, Notices).
SNAP-R18 local only · SNAP-R23 checks are notes, never rejections · see docs/SNAP_RULES.md"""
import os

import torch

import comfy.model_management
import comfy.model_patcher
import comfy.ops
import comfy.storage
import comfy.utils
import folder_paths
from comfy_api.latest import io

folder_paths.add_model_folder_path("face_recognition", os.path.join(folder_paths.models_dir, "face_recognition"), is_default=True)
folder_paths.folder_names_and_paths["face_recognition"][1].add(".safetensors")  # safetensors only

FaceModel = io.Custom("FACE_MODEL")


class IRBlock(torch.nn.Module):
    """An insightface IResNet block: BN, conv, BN, PReLU, strided conv, BN, plus the shortcut."""

    def __init__(self, inp, out, stride, operations):
        super().__init__()
        self.bn1 = operations.BatchNorm2d(inp, eps=1e-5)
        self.conv1 = operations.Conv2d(inp, out, 3, 1, 1, bias=False)
        self.bn2 = operations.BatchNorm2d(out, eps=1e-5)
        self.prelu = torch.nn.PReLU(out)
        self.conv2 = operations.Conv2d(out, out, 3, stride, 1, bias=False)
        self.bn3 = operations.BatchNorm2d(out, eps=1e-5)
        self.downsample = torch.nn.Sequential(operations.Conv2d(inp, out, 1, stride, bias=False), operations.BatchNorm2d(out, eps=1e-5)) if stride != 1 else None

    def forward(self, x):
        y = self.bn3(self.conv2(self.prelu(self.bn2(self.conv1(self.bn1(x))))))
        return y + (x if self.downsample is None else self.downsample(x))


class IResNet101(torch.nn.Module):
    """ArcFace's IResNet-101: 112x112 RGB in, (x - 0.5) / 0.5, a 512-d embedding out."""

    def __init__(self, operations):
        super().__init__()
        self.conv1 = operations.Conv2d(3, 64, 3, 1, 1, bias=False)
        self.bn1 = operations.BatchNorm2d(64, eps=1e-5)
        self.prelu = torch.nn.PReLU(64)
        inp = 64
        for i, (n, out) in enumerate(zip((3, 13, 30, 3), (64, 128, 256, 512))):
            setattr(self, f"layer{i + 1}", torch.nn.Sequential(IRBlock(inp, out, 2, operations), *[IRBlock(out, out, 1, operations) for _ in range(n - 1)]))
            inp = out
        self.bn2 = operations.BatchNorm2d(512, eps=1e-5)
        self.fc = operations.Linear(512 * 7 * 7, 512)
        self.features = torch.nn.BatchNorm1d(512, eps=1e-5)

    def forward(self, x):
        x = self.layer4(self.layer3(self.layer2(self.layer1(self.prelu(self.bn1(self.conv1(x)))))))
        return self.features(self.fc(self.bn2(x).flatten(1)))


class MAISnapFaceModelLoader(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAISnapFaceModelLoader",
            display_name="Load Face Model (Snap)",
            category="MAINodes/snap",
            description="Loads an ArcFace IResNet-101 face embedding model (safetensors) from models/face_recognition, for Snap's identity notes.",
            inputs=[io.Combo.Input("model_name", options=folder_paths.get_filename_list("face_recognition"))],
            outputs=[FaceModel.Output()],
        )

    @classmethod
    def execute(cls, model_name) -> io.NodeOutput:
        sd = comfy.utils.load_torch_file(folder_paths.get_full_path_or_raise("face_recognition", model_name), safe_load=True)
        sd = comfy.utils.state_dict_prefix_replace(sd, {"model.net.": ""})  # CVLface's own key prefix
        net = IResNet101(comfy.ops.manual_cast).eval()
        net.load_state_dict(sd)
        return io.NodeOutput(comfy.model_patcher.CoreModelPatcher(net, load_device=comfy.model_management.get_torch_device(), offload_device=comfy.model_management.unet_offload_device(),
                                                                  fast_disk=comfy.storage.state_dict_fast_disk(sd)))


def lightness(rgb):
    """CIE L* (0-100) of sRGB values in 0-1, as OpenCV's 8-bit BGR2Lab computes it (D65)."""
    lin = torch.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    y = lin @ torch.tensor([0.212671, 0.715160, 0.072169], device=rgb.device)
    return torch.where(y > 0.008856, 116 * y.pow(1 / 3) - 16, 903.3 * y)


def face_crop(image, mask, scale=1.5):
    """A square crop scale x the face mask's box, centred on it, edges repeated, at ArcFace's 112 px; None with no face."""
    ys, xs = torch.nonzero(mask > 0.5, as_tuple=True)
    if len(ys) == 0:
        return None
    y0, y1, x0, x1 = ys.min().item(), ys.max().item() + 1, xs.min().item(), xs.max().item() + 1
    half = int(max(x1 - x0, y1 - y0) * scale / 2)
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    padded = torch.nn.functional.pad(image.movedim(-1, 0)[None], (half, half, half, half), mode="replicate")
    return comfy.utils.common_upscale(padded[:, :, cy:cy + 2 * half, cx:cx + 2 * half], 112, 112, "area", "disabled")


def hair_l90(image, mask, min_pixels=2000):
    """L* 90th percentile of the hair mask (eroded 5 px, U56b's own metric); None when there's too little hair to read."""
    m = mask > 0.5
    if m.sum() < min_pixels:
        return None
    eroded = -torch.nn.functional.max_pool2d(-m[None, None].float(), 5, 1, 2)[0, 0] > 0.5
    return torch.quantile(lightness(image[eroded if eroded.sum() > 100 else m]), 0.9).item()


class MAISnapIdentity(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAISnapIdentity",
            display_name="Face and Hair (Snap)",
            category="MAINodes/snap",
            description="Per picture: an ArcFace embedding of the face (a square crop around the face mask) and the lit hair's "
                        "lightness (L* 90th percentile of the hair mask), for Snap's identity notes on edits. Masks from SAM3 Detect.",
            inputs=[FaceModel.Input("face_model"), io.Image.Input("image"), io.Mask.Input("face"), io.Mask.Input("hair")],
            outputs=[],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, face_model, image, face, hair) -> io.NodeOutput:
        comfy.model_management.load_model_gpu(face_model)
        faces, hairs = [], []
        for i in range(image.shape[0]):
            img = image[i, ..., :3].float()
            crop = face_crop(img, face[min(i, face.shape[0] - 1)])
            if crop is None:
                faces.append(None)
            else:
                x = (crop.to(face_model.load_device) - 0.5) / 0.5
                e = face_model.model(x) + face_model.model(x.flip(3))  # flip-averaged, as U56 measured it
                faces.append([round(v, 5) for v in torch.nn.functional.normalize(e, dim=-1)[0].tolist()])
            l90 = hair_l90(img, hair[min(i, hair.shape[0] - 1)])
            hairs.append(None if l90 is None else round(l90, 2))
        return io.NodeOutput(ui={"face": faces, "hair_l90": hairs})


NODE_CLASS_MAPPINGS = {"MAISnapFaceModelLoader": MAISnapFaceModelLoader, "MAISnapIdentity": MAISnapIdentity}
NODE_DISPLAY_NAME_MAPPINGS = {"MAISnapFaceModelLoader": "Load Face Model (Snap)", "MAISnapIdentity": "Face and Hair (Snap)"}
