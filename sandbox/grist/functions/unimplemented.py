"""
Decorator that marks functions as not implemented. It sets func.unimplemented=True.
Usage:

@unimplemented
def func(...):
  raise NotImplemented
"""
def unimplemented(func):
  func.unimplemented = True
  return func
