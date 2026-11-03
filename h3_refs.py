"""H3 References: the Reference to Video node's growing reference sockets (pictures, videos, their soundtracks, audio) as
one H3_REFS value, so a subgraph blueprint can take any number of references through a single input. H3 Reference to
Video (refs) runs core MiniMaxH3ReferenceToVideo with them unchanged: same resizing, tag order and video/audio pairing."""
from comfy_api.latest import io
from comfy_extras.nodes_minimax_h3 import MiniMaxH3ReferenceToVideo

Refs = io.Custom("H3_REFS")
GROUPS = ("ref_images", "ref_videos", "ref_video_audios", "ref_audios")


class H3References(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        # the core node's own reference groups (and limits), so a bundle holds exactly what it accepts
        core = {i.id: i for i in MiniMaxH3ReferenceToVideo.define_schema().inputs}
        return io.Schema(
            node_id="H3References",
            display_name="H3 References (alpha)",
            category="MAINodes/H3",
            description="Collect reference pictures, videos, their soundtracks and audio for H3 Reference to Video (refs). "
                        "Sockets grow as you connect them, up to the model's limits (9 pictures, 3 videos, 3 audio). In the "
                        "prompt call them <Picture 1>, <Video 1>, <Audio 1> in the order connected.",
            inputs=[core[name] for name in GROUPS],
            outputs=[Refs.Output(display_name="refs")],
        )

    @classmethod
    def execute(cls, ref_images=None, ref_videos=None, ref_video_audios=None, ref_audios=None) -> io.NodeOutput:
        return io.NodeOutput({"ref_images": ref_images or {}, "ref_videos": ref_videos or {},
                              "ref_video_audios": ref_video_audios or {}, "ref_audios": ref_audios or {}})


class H3ReferenceToVideoRefs(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        core = MiniMaxH3ReferenceToVideo.define_schema()
        return io.Schema(
            node_id="H3ReferenceToVideoRefs",
            display_name="H3 Reference to Video (refs) (alpha)",
            category="MAINodes/H3",
            description="MiniMax H3 Reference to Video with its references from one H3 References input. Same conditioning "
                        "as the core node; without refs it is plain text-to-video.",
            inputs=[i for i in core.inputs if i.id not in GROUPS] + [Refs.Input("refs", optional=True)],
            outputs=core.outputs,
        )

    @classmethod
    def execute(cls, clip, prompt, width, height, length, ref_image_size="match", vae=None, audio_vae=None,
                refs=None) -> io.NodeOutput:
        return MiniMaxH3ReferenceToVideo.execute(clip, prompt, width, height, length, ref_image_size=ref_image_size, vae=vae,
                                                 audio_vae=audio_vae, **(refs or {}))


NODE_CLASS_MAPPINGS = {"H3References": H3References, "H3ReferenceToVideoRefs": H3ReferenceToVideoRefs}
NODE_DISPLAY_NAME_MAPPINGS = {"H3References": "H3 References (alpha)", "H3ReferenceToVideoRefs": "H3 Reference to Video (refs) (alpha)"}
