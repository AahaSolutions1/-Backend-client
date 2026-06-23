const COLUMN_LIMITS = {
  // change_requests & notifications & users
  id: 50,
  title: 255,
  requester: 255,
  status: 100,
  priority: 100,
  recipient_email: 255,
  recipientEmail: 255,
  email: 255,
  password: 255,
  department: 255,

  // l1_requests
  changeNo: 50,
  change_no: 50,
  unit: 100,
  requestedTime: 20,
  requested_time: 20,
  changeIn: 255,
  change_in: 255,
  dept: 100,
  requestBy: 100,
  request_by: 100,
  processName: 100,
  process_name: 100,
  processLine: 100,
  process_line: 100,
  machineNo: 100,
  machine_no: 100,
  improvementArea: 100,
  improvement_area: 100,
  changeType: 100,
  change_type: 100,
  traceFrom: 65535,
  trace_from: 65535,
  traceTo: 65535,
  trace_to: 65535,
  riskAnalysis: 65535,
  risk_analysis: 65535,
  sopUpdate: 65535,
  sop_update: 65535,
  hodApproval: 65535,
  hod_approval: 65535,
  customerApproval: 100,
  customer_approval: 100,
  effectivenessMonitoring: 65535,
  effectiveness_monitoring: 65535,
  fileDesc: 65535,
  file_desc: 65535,
  fileImprovement: 65535,
  file_improvement: 65535,
  fileTraceFrom: 65535,
  file_trace_from: 65535,
  fileTraceTo: 65535,
  file_trace_to: 65535,
  fileRisk: 65535,
  file_risk: 65535,
  fileSop: 65535,
  file_sop: 65535,
  fileEffectiveness: 65535,
  file_effectiveness: 65535,

  // l2_validation_logs & attachments
  validationDate: 50,
  validation_date: 50,
  weldTest: 65535,
  weld_test: 65535,
  qaTest: 65535,
  qa_test: 65535,
  remarks: 65535,
  fileName: 255,
  file_name: 255,
  name: 255,

  // l3_approvals
  ped: 50,
  qad: 50,
  production: 50,
  maintenance: 50,
  pcl: 50,
  materials: 50,
  marketing: 50,
  hr: 50,
  safety: 50,
  unitHead: 50,
  unit_head: 50,

  // hod_approvals
  hodEmail: 255,
  hod_email: 255,
  hodDept: 100,
  hod_dept: 100,

  // effectiveness_logs
  context: 255,
  monthWise: 20,
  month_wise: 20,
  attachment: 65535,
  qaApproval: 50,
  qa_approval: 50,
};

export const validateLimits = (data) => {
  if (!data || typeof data !== 'object') return null;

  // Check if this object represents an uploaded base64 file attachment
  if (typeof data.name === 'string' && typeof data.type === 'string' && typeof data.data === 'string') {
    const MAX_SIZE = 100 * 1024 * 1024; // 100 MB
    const binarySize = Math.round((data.data.length * 3) / 4);
    if (binarySize > MAX_SIZE) {
      return `File "${data.name}" exceeds the maximum allowed size of 100MB.`;
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      const limit = COLUMN_LIMITS[key];
      if (limit !== undefined && value.length > limit) {
        const readableKey = key
          .replace(/_([a-z])/g, (_, letter) => ` ${letter.toUpperCase()}`)
          .replace(/([A-Z])/g, ' $1')
          .trim();
        const capitalizedKey = readableKey.charAt(0).toUpperCase() + readableKey.slice(1);

        return `${capitalizedKey} exceeds the database limit of ${limit} characters (currently ${value.length} characters). Please shorten it.`;
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const err = validateLimits(value);
      if (err) return err;
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          const err = validateLimits(item);
          if (err) return err;
        }
      }
    }
  }
  return null;
};
