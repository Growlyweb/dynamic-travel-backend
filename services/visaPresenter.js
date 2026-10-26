// Turns a VisaApplication document into what the dashboard receives.
//  - the storage path of a document is never sent: the file is fetched through its own authenticated route
//  - the timeline is newest first
//  - a list row leaves out the long embedded lists, a single application has everything
const byNewest = (a, b) => new Date(b.at) - new Date(a.at);

const presentApplication = (application, { list = false } = {}) => {
  const data = application.toJSON();

  data.documents = (data.documents || []).map(({ storagePath, ...document }) => document);

  if (list) {
    const { timeline, internalNotes, customerNotes, payments, vendorLines, ...rest } = data;
    return { ...rest, documentCount: data.documents.length };
  }

  data.timeline = [...(data.timeline || [])].sort(byNewest);
  data.internalNotes = [...(data.internalNotes || [])].sort(byNewest);
  data.customerNotes = [...(data.customerNotes || [])].sort(byNewest);
  return data;
};

module.exports = { presentApplication };
