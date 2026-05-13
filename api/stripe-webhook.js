import Stripe from 'stripe';
import { Resend } from 'resend';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const resend = new Resend(process.env.RESEND_API_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const fromAddress = process.env.MAIL_FROM || 'Mindism <book@mindism.net>';

  const rawBody = await readRawBody(req);
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const session = event.data.object;
  const customerEmail = session.customer_details?.email || session.customer_email;
  const customerName = session.customer_details?.name || 'there';

  if (!customerEmail) {
    console.error('No customer email on session', session.id);
    return res.status(200).json({ received: true, error: 'no email' });
  }

  const pdfPath = path.join(process.cwd(), 'downloads', 'the-book-of-mindism.pdf');
  const pdfBuffer = await readFile(pdfPath);

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: customerEmail,
    subject: 'Your copy of The Book of Mindism',
    text: `Hi ${customerName},\n\nThank you for your purchase. The Book of Mindism and some fascinating AI conversations are attached to this email as a PDF.`,
    attachments: [
      {
        filename: 'The-Book-of-Mindism.pdf',
        content: pdfBuffer.toString('base64'),
      },
    ],
  });

  if (error) {
    console.error('Resend send error:', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ received: true, emailed: customerEmail });
}
