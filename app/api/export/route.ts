// Generates the quotation .xlsx with embedded product/dimension photos.
// This is the whole reason the app exists instead of a spreadsheet, so every
// failure mode returns a clear message rather than crashing the export.
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { buildQuotationWorkbook, suggestedFilename, type SessionInfo, type QuoteItem } from '@/lib/build-quotation';

interface ExportRequestBody {
  session?: Partial<SessionInfo>;
  items?: QuoteItem[];
}

export async function POST(req: NextRequest) {
  try {
    let body: ExportRequestBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
    }

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json({ error: 'Nothing to export yet — add at least one item first.' }, { status: 400 });
    }

    const session: SessionInfo = {
      customer: body.session?.customer || '',
      project: body.session?.project || '',
      attn: body.session?.attn || '',
      ref: body.session?.ref || '',
      date: body.session?.date || '',
    };

    const workbook = await buildQuotationWorkbook(session, items);
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = suggestedFilename(session);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('Unhandled error in /api/export:', err);
    return NextResponse.json(
      { error: 'Could not build the Excel file. Nothing was sent — try again.' },
      { status: 500 }
    );
  }
}
