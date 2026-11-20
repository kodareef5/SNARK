"""Small helpers for the Rex's clips, shared by import.py and clips.py."""

import bpy


def fcurves(action):
    """Every F-curve of an action, through its layers and slots."""
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def cut(action, first, last, ticks):
    """Keeps frames first..last of a clip and plays them over `ticks`, starting at frame 0."""
    k = ticks / (last - first)
    for fc in fcurves(action):
        # Pin the ends, so the cut starts and ends on the clip's own poses.
        a, b = fc.evaluate(first), fc.evaluate(last)
        for key in reversed(list(fc.keyframe_points)):
            if key.co.x < first - 1e-3 or key.co.x > last + 1e-3:
                fc.keyframe_points.remove(key)
        fc.keyframe_points.insert(first, a)
        fc.keyframe_points.insert(last, b)
        for key in fc.keyframe_points:
            for point in (key.co, key.handle_left, key.handle_right):
                point.x = (point.x - first) * k
        fc.update()
    action.frame_range = (0, ticks)


def copy(action, name):
    """A copy of a clip under a new name."""
    made = action.copy()
    made.name = name
    return made


class Writer:
    """Writes a pose bone's location and rotation into a new action, frame by frame, without the action being played,
    so nothing evaluates it while the poses are being made."""

    def __init__(self, rig, name):
        self.rig = rig
        self.action = bpy.data.actions.new(name)
        slot = self.action.slots.new(id_type="OBJECT", name=rig.name)
        strip = self.action.layers.new("Layer").strips.new(type="KEYFRAME")
        bag = strip.channelbag(slot, ensure=True)
        self.curves = {}
        for pb in rig.pose.bones:
            for path, count in (("location", 3), ("rotation_quaternion", 4)):
                for i in range(count):
                    self.curves[(pb.name, path, i)] = bag.fcurves.new(f'pose.bones["{pb.name}"].{path}', index=i, group_name=pb.name)

    def key(self, frame):
        for pb in self.rig.pose.bones:
            for i, v in enumerate(pb.location):
                self.curves[(pb.name, "location", i)].keyframe_points.insert(frame, v, options={"FAST"})
            for i, v in enumerate(pb.rotation_quaternion):
                self.curves[(pb.name, "rotation_quaternion", i)].keyframe_points.insert(frame, v, options={"FAST"})

    def done(self, frames):
        for fc in self.curves.values():
            fc.update()
        self.action.frame_range = (0, frames)
        return self.action
