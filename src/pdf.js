import {getDocument, GlobalWorkerOptions} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(file, onProgress = () => {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({data: bytes}).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress({page: pageNumber, total: pdf.numPages});
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return {text: pages.join('\n\n'), pages, pageCount: pdf.numPages};
}
