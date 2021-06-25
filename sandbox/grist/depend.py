"""
depend.py provides classes and functions to manage the dependency graph for grist formulas.

Conceptually, all dependency relationships are the Edges (Node1, Relation, Node2), meaning that
Node1 depends on Node2. Each Node represents a column in a particular table (could be a derived
table, such as for subtotals). The Relation determines the row mapping, i.e. which rows in Node1
column need to be recomputed when a row changes in Node2 column.

When a formula is evaluated, the Record and RecordSet objects maintain a reference to the Relation
in use, while property access determines which Nodes (or columns) depend on one another.
"""

# Note: this is partly inspired by the implementation of the ninja build system, see
# https://github.com/martine/ninja/blob/master/src/graph.h

# Idea for the future: we can consider the concept from ninja of "order-only deps", which are
# needed before we can build the outputs, but which don't cause the outputs to rebuild. Support
# for this (with computed values properly persisted) could allow some cool use cases, like columns
# that recompute manually rather than automatically.

from collections import namedtuple
from sortedcontainers import SortedSet

class Node(namedtuple('Node', ('table_id', 'col_id'))):
  """
  Each Node in the dependency graph represents a column in a table.
  """
  __slots__ = ()    # This is a memory-saving device to keep these objects small

  def __str__(self):
    return '[%s.%s]' % (self.table_id, self.col_id)


class Edge(namedtuple('Edge', ('out_node', 'in_node', 'relation'))):
  """
  Each Edge connects two Nodes using a Relation. It says that out_node depends on in_node, so that
  a change to in_node should trigger a recomputation of out_node.
  """
  __slots__ = ()    # This is a memory-saving device to keep these objects small

  def __str__(self):
    return '[%s.%s: %s.%s @ %s]' % (self.out_node.table_id, self.out_node.col_id,
                                    self.in_node.table_id, self.in_node.col_id, self.relation)


class CircularRefError(RuntimeError):
  """
  Exception thrown when a formula column references itself, directly or indirectly.
  """
  pass


class _AllRows(object):
  """
  Special constant that indicates to `invalidate_deps` that all rows are affected and an entire
  column is to be invalidated.
  """
  pass

ALL_ROWS = _AllRows()

class Graph(object):
  """
  Represents the dependency graph for all data in a grist document.
  """
  def __init__(self):
    # The set of all Edges, i.e. the complete dependency graph.
    self._all_edges = set()

    # Map from node to the set of edges having it as the in_node (i.e. edges to dependents).
    self._in_node_map = {}

    # Map from node to the set of edges having it as the out_node (i.e. edges to dependencies).
    self._out_node_map = {}

  def dump_graph(self):
    """
    Print out the graph to stdout, for debugging.
    """
    print("Dependency graph (%d edges):" % len(self._all_edges))
    for edge in sorted(self._all_edges):
      print("  %s" % (edge,))

  def add_edge(self, out_node, in_node, relation):
    """
    Adds an edge to the global dependency graph: out_node depends on in_node, i.e. a change to
    in_node should trigger a recomputation of out_node.
    """
    edge = Edge(out_node, in_node, relation)
    self._all_edges.add(edge)
    self._in_node_map.setdefault(edge.in_node, set()).add(edge)
    self._out_node_map.setdefault(edge.out_node, set()).add(edge)

  def clear_dependencies(self, out_node):
    """
    Removes all edges which affect the given out_node, i.e. all of its dependencies.
    """
    remove_edges = self._out_node_map.pop(out_node, ())
    for edge in remove_edges:
      self._all_edges.remove(edge)
      self._in_node_map.get(edge.in_node, set()).remove(edge)
      edge.relation.reset_all()

  def reset_dependencies(self, node, dirty_rows):
    """
    For edges the given node depends on, reset the given output rows. This is called just before
    the rows get recomputed, to allow the relations to clear out state for those rows if needed.
    """
    in_edges = self._out_node_map.get(node, ())
    for edge in in_edges:
      edge.relation.reset_rows(dirty_rows)

  def remove_node_if_unused(self, node):
    """
    Removes the given node if it has no dependents. Returns True if the node is gone, False if the
    node has dependents.
    """
    if self._in_node_map.get(node, None):
      return False
    self.clear_dependencies(node)
    self._in_node_map.pop(node, None)
    return True

  def invalidate_deps(self, dirty_node, dirty_rows, recompute_map, include_self=True):
    """
    Invalidates the given rows in the given node, and all of its dependents, i.e. all the nodes
    that recursively depend on dirty_node. If include_self is False, then skips the given node
    (e.g. if the node is raw data rather than formula). Results are added to recompute_map, which
    is a dict mapping Nodes to sets of rows that need to be recomputed.

    If dirty_rows is ALL_ROWS, the whole column is affected, and dependencies get recomputed from
    scratch. ALL_ROWS propagates to all dependent columns, so those also get recomputed in full.
    """
    to_invalidate = [(dirty_node, dirty_rows)]

    while to_invalidate:
      dirty_node, dirty_rows = to_invalidate.pop()
      if include_self:
        if recompute_map.get(dirty_node) == ALL_ROWS:
          continue
        if dirty_rows == ALL_ROWS:
          recompute_map[dirty_node] = ALL_ROWS
          # If all rows are being recomputed, clear the dependencies of the affected column. (We add
          # dependencies in the course of recomputing, but we can only start from an empty set of
          # dependencies if we are about to recompute all rows.)
          self.clear_dependencies(dirty_node)
        else:
          out_rows = recompute_map.setdefault(dirty_node, SortedSet())
          prev_count = len(out_rows)
          out_rows.update(dirty_rows)
          # Don't bother recursing into dependencies if we didn't actually update anything.
          if len(out_rows) <= prev_count:
            continue

      include_self = True

      for edge in self._in_node_map.get(dirty_node, ()):
        affected_rows = edge.relation.get_affected_rows(dirty_rows)

        # Previously this was:
        #   self.invalidate_deps(edge.out_node, affected_rows, recompute_map, include_self=True)
        # but that led to a recursion error, so now we do the equivalent
        # without actual recursion, hence the while loop
        to_invalidate.append((edge.out_node, affected_rows))
