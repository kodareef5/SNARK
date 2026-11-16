"""Continuous slide surfaces from the same persisted paths as source collision."""
from slide_courses import course_rings


def slides(mesh,layout,number):
    course=next(c for c in layout['waterpark']['courses'] if c['number']==number)
    mesh.loft(course_rings(course,mesh.level),course['finish'])
