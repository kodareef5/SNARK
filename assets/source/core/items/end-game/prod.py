"""Shape the electric prod's exterior around the palm in engine metres."""

from math import copysign, cos, pi, sin, tau

from hand_geometry import Z


def moulded_shell(prop, stations, sides, surface):
    angles = [side * tau / sides for side in range(sides)]
    outline = [(copysign(abs(cos(angle)) ** 0.78, cos(angle)),
                copysign(abs(sin(angle)) ** 0.78, sin(angle))) for angle in angles]
    rings = [[(wide * x, lift + tall * y, z) for x, y in outline]
             for z, lift, wide, tall in stations]
    prop.shell(rings, surface, smooth=True)


def prod(prop):
    level = prop.level
    grip = (
        (-0.130, -0.006, 0.027, 0.029),
        (-0.123, -0.006, 0.034, 0.035),
        (-0.110, -0.006, 0.038, 0.040),
        (-0.086, -0.007, 0.036, 0.039),
        (-0.060, -0.006, 0.031, 0.034),
        (-0.030, -0.004, 0.029, 0.031),
        (0.000, -0.002, 0.030, 0.032),
        (0.034, -0.001, 0.033, 0.035),
        (0.063, 0.001, 0.039, 0.040),
        (0.085, 0.002, 0.041, 0.043),
        (0.110, 0.001, 0.039, 0.040),
        (0.132, 0.000, 0.033, 0.034),
        (0.148, 0.000, 0.030, 0.030),
        (0.156, 0.000, 0.027, 0.027),
    )
    grip_sections = (
        tuple(range(len(grip))),
        (0, 2, 3, 4, 5, 7, 9, 10, 12, 13),
        (0, 2, 5, 7, 9, 11, 13),
        (0, 2, 5, 9, 13),
    )
    moulded_shell(prop, [grip[i] for i in grip_sections[level]], (24, 16, 10, 6)[level], "rubber")

    stem = (
        (0.137, 0.022), (0.154, 0.026), (0.178, 0.026), (0.207, 0.021),
        (0.246, 0.019), (0.573, 0.018), (0.606, 0.021), (0.641, 0.021),
    )
    stem_sections = (
        tuple(range(len(stem))), (0, 2, 3, 4, 5, 7), (0, 2, 4, 7), (0, 2, 7),
    )
    prop.tube((0, 0, 0), Z, [stem[i] for i in stem_sections[level]],
              (16, 10, 8, 6)[level], "amber", oval=0.93)

    head = (
        (0.606, 0.000, 0.022, 0.022),
        (0.630, 0.000, 0.025, 0.022),
        (0.651, 0.000, 0.042, 0.027),
        (0.674, 0.000, 0.061, 0.029),
        (0.695, 0.000, 0.064, 0.027),
        (0.712, 0.000, 0.061, 0.025),
        (0.722, 0.000, 0.055, 0.023),
    )
    head_sections = (
        tuple(range(len(head))), (0, 2, 3, 4, 6), (0, 2, 4, 6), (0, 4, 6),
    )
    moulded_shell(prop, [head[i] for i in head_sections[level]], (18, 12, 8, 6)[level], "rubber")

    terminal = (
        (0.702, 0.015), (0.717, 0.017), (0.736, 0.018),
        (0.751, 0.018), (0.762, 0.015), (0.769, 0.011),
    )
    terminal_sections = (
        tuple(range(len(terminal))), (0, 1, 3, 4, 5), (0, 2, 3, 5), (0, 3, 5),
    )
    for side in (-1, 1):
        prop.tube((side * 0.036, 0, 0), Z, [terminal[i] for i in terminal_sections[level]],
                  (12, 8, 6, 4)[level], "steel", oval=0.89, phase=pi / 4 if level == 3 else 0)
