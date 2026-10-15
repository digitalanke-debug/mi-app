/**
 * Cuenta de cobro en PDF con los datos de la empresa y del cliente.
 */
import PDFDocument from 'pdfkit'
import { cop, fmtDate } from '../src/lib/format.js'
import { invoiceTotal, invoicePaid, invoiceBalance } from '../src/lib/invoices.js'

const UNIDADES = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve']
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

function cientos(n) {
  if (n === 0) return ''
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100)
  const r = n % 100
  let out = CENTENAS[c]
  if (r > 0) {
    if (r < 30) out += (out ? ' ' : '') + UNIDADES[r]
    else {
      const d = Math.floor(r / 10)
      const u = r % 10
      out += (out ? ' ' : '') + DECENAS[d] + (u ? ' y ' + UNIDADES[u] : '')
    }
  }
  return out
}

/** Número entero a letras en español (hasta miles de millones) */
export function numeroALetras(n) {
  n = Math.floor(Math.abs(Number(n) || 0))
  if (n === 0) return 'cero'
  const partes = []
  const miles = Math.floor(n / 1000) % 1000
  const millones = Math.floor(n / 1000000) % 1000
  const milMillones = Math.floor(n / 1000000000)
  if (milMillones) partes.push(milMillones === 1 ? 'mil' : cientos(milMillones) + ' mil')
  if (millones || milMillones) partes.push(millones === 1 && !milMillones ? 'un millón' : (millones ? cientos(millones) + ' ' : '') + 'millones')
  if (miles) partes.push(miles === 1 ? 'mil' : cientos(miles) + ' mil')
  const resto = n % 1000
  if (resto) partes.push(cientos(resto))
  return partes.join(' ').replace(/\s+/g, ' ').trim()
}

/** Genera el PDF y devuelve un Buffer */
export function cuentaDeCobroPDF({ company, client, invoice }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const total = invoiceTotal(invoice)
    const pagado = invoicePaid(invoice)
    const saldo = invoiceBalance(invoice)
    const navy = '#1f3a5f'
    const gray = '#64748b'

    // Encabezado de la empresa
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(18).text(company.name, { align: 'left' })
    doc.fillColor(gray).font('Helvetica').fontSize(9.5)
    const lineas = [company.nit && `NIT ${company.nit}`, [company.address, company.city].filter(Boolean).join(', '), [company.phone && `Tel. ${company.phone}`, company.email].filter(Boolean).join(' · ')].filter(Boolean)
    for (const l of lineas) doc.text(l)
    doc.moveDown(0.6)
    doc.moveTo(56, doc.y).lineTo(556, doc.y).strokeColor('#e3e8ef').stroke()
    doc.moveDown(0.8)

    // Título
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(16).text(`CUENTA DE COBRO No. ${invoice.number}`, { align: 'right' })
    doc.fillColor(gray).font('Helvetica').fontSize(10).text(`${company.city ? company.city + ', ' : ''}${fmtDate(invoice.issueDate)}`, { align: 'right' })
    doc.text(`Vence: ${fmtDate(invoice.dueDate)}`, { align: 'right' })
    doc.moveDown(1.2)

    // Cliente
    doc.fillColor(gray).fontSize(9).text('DEBE A')
    doc.fillColor('#1b2430').font('Helvetica-Bold').fontSize(12).text(company.name)
    doc.moveDown(0.6)
    doc.fillColor(gray).font('Helvetica').fontSize(9).text('SEÑOR(ES)')
    doc.fillColor('#1b2430').font('Helvetica-Bold').fontSize(12).text(client.name)
    doc.font('Helvetica').fontSize(10).fillColor('#1b2430')
    if (client.nit) doc.text(`NIT / C.C. ${client.nit}`)
    if (client.email) doc.text(client.email)
    doc.moveDown(1)

    // Concepto
    doc.fillColor(gray).fontSize(9).text('POR CONCEPTO DE')
    doc.fillColor('#1b2430').font('Helvetica').fontSize(11).text(invoice.concept)
    doc.moveDown(0.8)

    // Tabla de ítems
    const x0 = 56
    const wDesc = 330
    const wTipo = 80
    const wVal = 90
    let y = doc.y
    doc.rect(x0, y, wDesc + wTipo + wVal, 20).fill('#f4f6f9')
    doc.fillColor(gray).font('Helvetica-Bold').fontSize(9)
    doc.text('DETALLE', x0 + 8, y + 6, { width: wDesc - 16 })
    doc.text('TIPO', x0 + wDesc, y + 6, { width: wTipo })
    doc.text('VALOR', x0 + wDesc + wTipo, y + 6, { width: wVal - 8, align: 'right' })
    y += 20
    doc.font('Helvetica').fontSize(10).fillColor('#1b2430')
    for (const it of invoice.items || []) {
      const h = Math.max(18, doc.heightOfString(it.desc || '', { width: wDesc - 16 }) + 8)
      doc.text(it.desc || '', x0 + 8, y + 4, { width: wDesc - 16 })
      doc.fillColor(gray).text(it.kind === 'gastos' ? 'Gasto' : 'Honorarios', x0 + wDesc, y + 4, { width: wTipo })
      doc.fillColor('#1b2430').text(cop(it.amount), x0 + wDesc + wTipo, y + 4, { width: wVal - 8, align: 'right' })
      y += h
      doc.moveTo(x0, y).lineTo(x0 + wDesc + wTipo + wVal, y).strokeColor('#e3e8ef').stroke()
    }
    y += 6
    doc.font('Helvetica-Bold').fontSize(11)
    doc.text('TOTAL', x0 + wDesc, y + 2, { width: wTipo })
    doc.text(cop(total), x0 + wDesc + wTipo, y + 2, { width: wVal - 8, align: 'right' })
    y += 18
    if (pagado > 0) {
      doc.font('Helvetica').fontSize(10).fillColor(gray)
      doc.text('Abonado', x0 + wDesc, y + 2, { width: wTipo })
      doc.text(cop(pagado), x0 + wDesc + wTipo, y + 2, { width: wVal - 8, align: 'right' })
      y += 16
      doc.font('Helvetica-Bold').fillColor('#1b2430')
      doc.text('SALDO', x0 + wDesc, y + 2, { width: wTipo })
      doc.text(cop(saldo), x0 + wDesc + wTipo, y + 2, { width: wVal - 8, align: 'right' })
      y += 18
    }
    doc.x = x0
    doc.y = y + 8
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(gray)
    doc.text(`Son: ${numeroALetras(total)} pesos m/cte.`)
    doc.moveDown(1.2)

    // Pago
    if (company.bankInfo) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1b2430').text('Favor consignar o transferir a:')
      doc.font('Helvetica').fontSize(10).text(company.bankInfo)
      doc.moveDown(1)
    }
    if (company.footer) {
      doc.font('Helvetica').fontSize(9).fillColor(gray).text(company.footer)
      doc.moveDown(1)
    }

    // Firma
    doc.moveDown(2)
    doc.moveTo(56, doc.y).lineTo(260, doc.y).strokeColor('#1b2430').stroke()
    doc.moveDown(0.3)
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1b2430').text(company.name)
    if (company.nit) doc.font('Helvetica').fontSize(9).fillColor(gray).text(`NIT ${company.nit}`)

    doc.end()
  })
}
