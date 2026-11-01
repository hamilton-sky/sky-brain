"""Forkboard: review a design on its diagrams before the code is written.

A tool (feature-flow, or anything that can write JSON) hands Forkboard a review document; Forkboard makes it a
page people read, edit and ask questions on, and gives the tool back what they did. See README.md.
"""

__version__ = "0.3.0"
SCHEMA = "bundle/1"  # the review document's format; a reader refuses a major it does not know
