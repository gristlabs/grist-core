import unittest
import messytables
import os

class TestMessyTables(unittest.TestCase):

  # Just a skeleton test
  def test_any_tableset(self):
    path = os.path.join(os.path.dirname(__file__),
                        "fixtures", "nyc_schools_progress_report_ec_2013.xlsx")
    with open(path, "r") as f:
      table_set = messytables.any.any_tableset(f, extension=os.path.splitext(path)[1])

    self.assertIsInstance(table_set, messytables.XLSTableSet)
    self.assertEqual([t.name for t in table_set.tables],
                     ['Summary', 'Student Progress', 'Student Performance', 'School Environment',
                      'Closing the Achievement Gap', 'Middle School Course Metrics',
                      'All Information', 'Peer Groups'])


if __name__ == "__main__":
  unittest.main()
