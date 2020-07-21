/**
 * File for configuring the metric collection bucket duration, data push intervals between client, server,
 * and Grist Metrics EC2 instance, as well as individual metrics collected in the client and server.
 */

// Time interval settings (ms)
exports.BUCKET_SIZE = 60 * 1000;

exports.CLIENT_PUSH_INTERVAL = 120 * 1000;
exports.SERVER_PUSH_INTERVAL = 120 * 1000;
exports.MAX_PENDING_BUCKETS = 40;
exports.CONN_RETRY = 20 * 1000;

// Metrics use the general form:
//    <category>.<short desc>
// With prefixes, measurement type, and clientId/serverId added automatically on send.

// 'type' is the measurement tool type, with options 'Switch', 'Counter', 'Gauge', 'Timer', and
//  'ExecutionTimer'. (See metricTools.js for details)
// Suffixes are added to the metric names depending on their measurement tool.
// 'Switch'         => '.instances'
// 'Gauge'          => '.total'
// 'Counter'        => '.count'
// 'Timer'          => '.time'
// 'ExecutionTimer' => '.execution_time', '.count' (Execution timer automatically records a count)

exports.clientMetrics = [
  // General
  {
    name:   'sidepane.opens',
    type:   'Counter',
    desc:   'Number of times the side pane is opened'
  },
  {
    name:   'app.client_active_span',
    type:   'Timer',
    desc:   'Total client time spent using grist'
  },
  {
    name:   'app.connected_to_server_span',
    type:   'Timer',
    desc:   'Total time spent connected to the server'
  },
  {
    name:   'app.disconnected_from_server_span',
    type:   'Timer',
    desc:   'Total time spent disconnected from the server'
  },
  // Docs
  {
    name:   'docs.num_open_6+_tables',
    type:   'SamplingGauge',
    desc:   'Number of open docs with more than 5 tables'
  },
  {
    name:   'docs.num_open_0-5_tables',
    type:   'SamplingGauge',
    desc:   'Number of open docs with 0-5 tables'
  },
  // Tables
  {
    name:   'tables.num_tables',
    type:   'SamplingGauge',
    desc:   'Number of open tables'
  },
  {
    name:   'tables.num_summary_tables',
    type:   'SamplingGauge',
    desc:   'Number of open sections in the current view'
  },
  // Views
  {
    name:   'views.code_view_open_span',
    type:   'Timer',
    desc:   'Time spent with code viewer open'
  },
  // Sections
  {
    name:   'sections.grid_open_span',
    type:   'Timer',
    desc:   'Time spent with gridview open'
  },
  {
    name:   'sections.detail_open_span',
    type:   'Timer',
    desc:   'Time spent with gridview open'
  },
  {
    name:   'sections.num_grid_sections',
    type:   'SamplingGauge',
    desc:   'Number of open sections in the current view'
  },
  {
    name:   'sections.num_detail_sections',
    type:   'SamplingGauge',
    desc:   'Number of open sections in the current view'
  },
  {
    name:   'sections.num_chart_sections',
    type:   'SamplingGauge',
    desc:   'Number of open sections in the current view'
  },
  {
    name:   'sections.multiple_open_span',
    type:   'Timer',
    desc:   'Time spent with multiple sections open'
  },
  // Performance
  {
    name:   'performance.server_action',
    type:   'ExecutionTimer',
    desc:   'Time for a server action to complete'
  },
  {
    name:   'performance.doc_load',
    type:   'ExecutionTimer',
    desc:   'Time to load a document'
  },
  // Columns
  {
    name:   'cols.num_formula_cols',
    type:   'SamplingGauge',
    desc:   'Number of formula columns in open documents'
  },
  {
    name:   'cols.num_text_cols',
    type:   'SamplingGauge',
    desc:   'Number of text columns in open documents'
  },
  {
    name:   'cols.num_int_cols',
    type:   'SamplingGauge',
    desc:   'Number of integer columns in open documents'
  },
  {
    name:   'cols.num_numeric_cols',
    type:   'SamplingGauge',
    desc:   'Number of numeric columns in open documents'
  },
  {
    name:   'cols.num_date_cols',
    type:   'SamplingGauge',
    desc:   'Number of date columns in open documents'
  },
  {
    name:   'cols.num_datetime_cols',
    type:   'SamplingGauge',
    desc:   'Number of datetime columns in open documents'
  },
  {
    name:   'cols.num_ref_cols',
    type:   'SamplingGauge',
    desc:   'Number of reference columns in open documents'
  },
  {
    name:   'cols.num_attachments_cols',
    type:   'SamplingGauge',
    desc:   'Number of attachments columns in open documents'
  },
  {
    name:   'performance.front_end_errors',
    type:   'Counter',
    desc:   'Number of frontend errors'
  }
  // TODO: Implement the following:
  // {
  //   name:   'grist-rt.performance.view_swap',
  //   type:   'ExecutionTimer',
  //   desc:   'Time to swap views'
  // }
];

exports.serverMetrics = [
  // General
  {
    name:   'app.server_active',
    type:   'Switch',
    desc:   'Number of users currently using grist'
  },
  {
    name:   'app.server_active_span',
    type:   'Timer',
    desc:   'Total server time spent using grist'
  },
  {
    name:   'app.have_doc_open',
    type:   'Switch',
    desc:   'Number of users with at least one doc open'
  },
  {
    name:   'app.doc_open_span',
    type:   'Timer',
    desc:   'Total time spent with at least one doc open'
  },
  // Docs
  {
    name:   'docs.num_open',
    type:   'Gauge',
    desc:   'Number of open docs'
  },
  {
    name:   'performance.node_memory_usage',
    type:   'SamplingGauge',
    desc:   'Memory utilization in bytes of the node process'
  }
  // TODO: Implement the following:
  // {
  //   name:   'grist-rt.docs.total_size_open',
  //   type:   'Gauge',
  //   desc:   'Cumulative size of open docs'
  // }
  // {
  //   name:   'grist-rt.performance.open_standalone_app',
  //   type:   'ExecutionTimer',
  //   desc:   'Time to start standalone app'
  // }
  // {
  //   name:   'grist-rt.performance.sandbox_recalculation',
  //   type:   'ExecutionTimer',
  //   desc:   'Time for sandbox recalculation to occur'
  // }
  // {
  //   name:   'grist-rt.performance.open_standalone_app',
  //   type:   'ExecutionTimer',
  //   desc:   'Time to start standalone app'
  // }
  // {
  //   name:   'grist-rt.performance.node_cpu_usage',
  //   type:   'SamplingGauge',
  //   desc:   'Amount of time node was using the cpu in the interval'
  // }
  // {
  //   name:   'grist-rt.performance.sandbox_cpu_usage',
  //   type:   'SamplingGauge',
  //   desc:   'Amount of time the sandbox was using the cpu in the interval'
  // }
  // {
  //   name:   'grist-rt.performance.chrome_cpu_usage',
  //   type:   'SamplingGauge',
  //   desc:   'Amount of time chrome was using the cpu in the interval'
  // }
  // {
  //   name:   'grist-rt.performance.sandbox_memory_usage',
  //   type:   'SamplingGauge',
  //   desc:   'Memory utilization in bytes of the sandbox process'
  // }
  // {
  //   name:   'grist-rt.performance.chrome_memory_usage',
  //   type:   'SamplingGauge',
  //   desc:   'Memory utilization in bytes of the chrome process'
  // }
];
