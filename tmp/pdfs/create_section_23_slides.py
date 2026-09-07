from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle


ROOT = Path("/Users/it/Desktop/CS-CMU/SE-Iot")
OUTPUT = ROOT / "output/pdf/SE-IoT_Section_2.3_Product_Backlog.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

PAGE_W, PAGE_H = landscape((7.5 * inch, 13.333333 * inch))
MARGIN = 42

NAVY = HexColor("#0B1739")
BLUE = HexColor("#2563EB")
CYAN = HexColor("#0EA5E9")
GREEN = HexColor("#16A34A")
AMBER = HexColor("#D97706")
RED = HexColor("#DC2626")
INK = HexColor("#0F172A")
MUTED = HexColor("#475569")
LIGHT = HexColor("#F1F5F9")
RULE = HexColor("#CBD5E1")

pdfmetrics.registerFont(TTFont("Tahoma", "/System/Library/Fonts/Supplemental/Tahoma.ttf"))
pdfmetrics.registerFont(TTFont("TahomaBold", "/System/Library/Fonts/Supplemental/Tahoma Bold.ttf"))


def paragraph(c, text, x, y_top, width, height, size=18, color=INK,
              font="Tahoma", leading=None, alignment=TA_LEFT):
    style = ParagraphStyle(
        name="slide",
        fontName=font,
        fontSize=size,
        leading=leading or size * 1.28,
        textColor=color,
        alignment=alignment,
        spaceAfter=0,
        spaceBefore=0,
    )
    p = Paragraph(text, style)
    _, used_h = p.wrap(width, height)
    p.drawOn(c, x, y_top - used_h)
    return used_h


def title(c, text, subtitle=None):
    paragraph(c, text, MARGIN, PAGE_H - 34, PAGE_W - 2 * MARGIN, 76,
              size=28, font="TahomaBold", leading=34)
    c.setStrokeColor(BLUE)
    c.setLineWidth(3)
    c.line(MARGIN, PAGE_H - 91, MARGIN + 112, PAGE_H - 91)
    if subtitle:
        paragraph(c, subtitle, MARGIN, PAGE_H - 105, PAGE_W - 2 * MARGIN, 42,
                  size=14, color=MUTED, leading=18)


def footer(c, page_no):
    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.line(MARGIN, 27, PAGE_W - MARGIN, 27)
    c.setFont("Tahoma", 8.5)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, 13, "2.3 PRODUCT BACKLOG - SE-IoT MVP")
    c.drawRightString(PAGE_W - MARGIN, 13, str(page_no))


def rounded_panel(c, x, y, w, h, fill=LIGHT, radius=10, stroke=None):
    c.setFillColor(fill)
    c.setStrokeColor(stroke or fill)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1 if stroke else 0)


def metric(c, x, y, w, h, number, label, detail, accent):
    rounded_panel(c, x, y, w, h, fill=LIGHT)
    c.setFillColor(accent)
    c.rect(x, y, 8, h, fill=1, stroke=0)
    c.setFont("TahomaBold", 34)
    c.setFillColor(INK)
    c.drawString(x + 24, y + h - 54, number)
    c.setFont("TahomaBold", 15)
    c.drawString(x + 24, y + h - 82, label)
    paragraph(c, detail, x + 24, y + h - 98, w - 44, 50,
              size=11.5, color=MUTED, leading=15)


def bullet_line(c, x, y_top, text, color=BLUE, size=13, width=250):
    c.setFillColor(color)
    c.circle(x + 4, y_top - 8, 3.2, fill=1, stroke=0)
    return paragraph(c, text, x + 16, y_top, width - 16, 54,
                     size=size, color=INK, leading=size * 1.3)


def slide_1(c):
    title(c, "MVP Backlog มุ่งสร้างระบบตั้งแต่ Sensor ถึง Dashboard",
          "ทีมเลือกเฉพาะ P0 ที่จำเป็นต่อการส่งมอบคุณค่าแบบ end-to-end")

    c.setFont("TahomaBold", 12)
    c.setFillColor(BLUE)
    c.drawString(MARGIN, 385, "MVP SCOPE - 15 OF 34 STORIES")

    gap = 18
    card_w = (PAGE_W - 2 * MARGIN - 2 * gap) / 3
    y = 198
    metric(c, MARGIN, y, card_w, 165, "15", "P0 Stories",
           "Functional stories และ technical enablers ที่ต้องมีใน MVP", BLUE)
    metric(c, MARGIN + card_w + gap, y, card_w, 165, "107", "Story Points",
           "ความซับซ้อนและ effort โดยประมาณของ MVP backlog", CYAN)
    metric(c, MARGIN + 2 * (card_w + gap), y, card_w, 165, "6", "Capabilities",
           "Research, Hardware, Server, Dashboard, Auth และ Alerts", GREEN)

    c.setFillColor(NAVY)
    c.roundRect(MARGIN, 61, PAGE_W - 2 * MARGIN, 105, 10, fill=1, stroke=0)
    paragraph(c,
              "<b>Priority logic:</b> Sensor และ Server ต้องพร้อมก่อน Dashboard จะใช้ข้อมูลจริงได้; Authentication และ Alert Detection ทำให้ MVP ปลอดภัยและนำไปใช้งานได้",
              MARGIN + 24, 143, PAGE_W - 2 * MARGIN - 48, 66,
              size=15, color=white, leading=21)
    footer(c, 1)


def slide_2(c):
    title(c, "Functional Stories เชื่อมข้อมูลผ่าน 5 ขั้น",
          "เล่าตาม data flow แทนการอ่าน Jira ทีละรายการ")

    centers = [92, 280, 468, 656, 844]
    line_y = 335
    c.setStrokeColor(RULE)
    c.setLineWidth(3)
    for i in range(len(centers) - 1):
        c.line(centers[i] + 50, line_y, centers[i + 1] - 50, line_y)
        c.setFillColor(BLUE)
        c.setStrokeColor(BLUE)
        c.line(centers[i + 1] - 63, line_y + 7, centers[i + 1] - 50, line_y)
        c.line(centers[i + 1] - 63, line_y - 7, centers[i + 1] - 50, line_y)

    stages = [
        ("01", "ESP32", "Select, read, calibrate และ publish sensor data", "4 stories / 26 pts", BLUE),
        ("02", "Pi + Broker", "Deploy Docker Mosquitto และ network access", "1 story / 13 pts", CYAN),
        ("03", "Backend", "Ingest, validate และ persist readings", "2 stories / 13 pts", GREEN),
        ("04", "Sensor API", "Expose latest และ historical readings", "1 story / 8 pts", AMBER),
        ("05", "Dashboard", "Display live values และ historical trends", "2 stories / 13 pts", RED),
    ]

    for cx, (num, name, desc, points, accent) in zip(centers, stages):
        c.setFillColor(accent)
        c.circle(cx, line_y, 24, fill=1, stroke=0)
        c.setFont("TahomaBold", 12)
        c.setFillColor(white)
        c.drawCentredString(cx, line_y - 4, num)
        paragraph(c, name, cx - 74, line_y - 44, 148, 35,
                  size=16, font="TahomaBold", leading=20, alignment=1)
        paragraph(c, desc, cx - 78, line_y - 85, 156, 74,
                  size=11.5, color=MUTED, leading=15, alignment=1)
        c.setFillColor(accent)
        c.setFont("TahomaBold", 11)
        c.drawCentredString(cx, 188, points)

    rounded_panel(c, MARGIN, 69, PAGE_W - 2 * MARGIN, 82, fill=LIGHT)
    paragraph(c,
              "<b>Core user story:</b> As a laboratory user, I want current and historical sensor readings so that I can understand laboratory conditions and identify changes over time.",
              MARGIN + 22, 133, PAGE_W - 2 * MARGIN - 44, 56,
              size=14.5, color=INK, leading=20)
    footer(c, 2)


def slide_3(c):
    title(c, "User-facing Stories เปลี่ยนข้อมูลเป็นการตัดสินใจ")

    gap = 18
    col_w = (PAGE_W - 2 * MARGIN - 2 * gap) / 3
    groups = [
        ("MONITORING", "เห็นสถานะปัจจุบันและแนวโน้ม", BLUE,
         ["P01-2-S01  Live Sensor Overview - 5 pts",
          "P01-2-S03  Historical Trends - 8 pts"],
         "ผู้ใช้ตรวจสอบสภาพห้องได้จากจุดเดียว"),
        ("SECURE ACCESS", "เข้าถึงระบบตามบทบาท", GREEN,
         ["P01-25-S02  Sign In & Session - 8 pts",
          "P01-25-S05  Role-based Access - 8 pts"],
         "ผู้ใช้เห็นและแก้ไขเฉพาะสิ่งที่ได้รับอนุญาต"),
        ("ALERTING", "ตรวจพบความผิดปกติ", AMBER,
         ["P01-39-S01  Configure Alert Rules - 5 pts",
          "P01-39-S02  Detect Abnormal Conditions - 8 pts"],
         "ระบบชี้สถานะ warning ก่อนปัญหารุนแรง"),
    ]

    for i, (label, headline, accent, stories, value) in enumerate(groups):
        x = MARGIN + i * (col_w + gap)
        rounded_panel(c, x, 116, col_w, 333, fill=LIGHT)
        c.setFillColor(accent)
        c.rect(x, 421, col_w, 28, fill=1, stroke=0)
        c.setFont("TahomaBold", 10.5)
        c.setFillColor(white)
        c.drawString(x + 18, 430, label)
        paragraph(c, headline, x + 18, 398, col_w - 36, 58,
                  size=18, font="TahomaBold", leading=23)
        y = 322
        for story in stories:
            used = bullet_line(c, x + 18, y, story, color=accent,
                               size=11.5, width=col_w - 36)
            y -= max(44, used + 15)
        c.setStrokeColor(RULE)
        c.line(x + 18, 206, x + col_w - 18, 206)
        paragraph(c, "<b>Value:</b> " + value, x + 18, 187,
                  col_w - 36, 58, size=12.5, color=MUTED, leading=17)

    c.setFont("Tahoma", 11)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, 76, "Research enabler: Define Environmental Monitoring Requirements - 5 pts")
    footer(c, 3)


def slide_4(c):
    title(c, "Non-functional Requirements ต้องวัดและทดสอบได้",
          "Functional บอกว่าระบบทำอะไร; NFR กำหนดว่าระบบต้องทำงานดีแค่ไหน")

    data = [
        ["Category", "Measurable MVP requirement"],
        ["Performance", "Dashboard refresh ข้อมูลทุก 5 วินาที"],
        ["Reliability", "ข้อมูลไม่หายหลัง container หรือ Raspberry Pi restart"],
        ["Security", "MQTT ปิด anonymous access และใช้ per-device ACL"],
        ["Data", "เก็บย้อนหลัง 31 วัน และแจ้งเตือน storage ที่ 85%"],
        ["Recovery", "Broker, backend และ frontend start อัตโนมัติหลัง reboot"],
        ["Usability", "รองรับ desktop/mobile และ Loading, Error, Offline, Stale states"],
    ]
    table = Table(data, colWidths=[178, PAGE_W - 2 * MARGIN - 178], rowHeights=[38] + [49] * 6)
    table.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Tahoma", 12.5),
        ("FONT", (0, 0), (-1, 0), "TahomaBold", 13),
        ("FONT", (0, 1), (0, -1), "TahomaBold", 12.5),
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("BACKGROUND", (0, 1), (-1, -1), white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
    ]))
    table.wrapOn(c, PAGE_W - 2 * MARGIN, 360)
    table.drawOn(c, MARGIN, 88)
    footer(c, 4)


def slide_5(c):
    title(c, "Constraints เป็น Design Input ของ MVP",
          "ข้อจำกัดที่พบจริงถูกแปลงเป็นการตัดสินใจทางสถาปัตยกรรม")

    constraints = [
        ("Raspberry Pi 3 ทรัพยากรจำกัด", "ใช้ Flask, SQLite และ Docker services ที่เบา"),
        ("microSD มี write cycle จำกัด", "ใช้ retention และควบคุม write frequency"),
        ("IoT network ใช้ DHCP", "ไม่ hard-code IP; ESP32 ใช้ tempse.local"),
        ("mDNS ข้าม subnet ไม่ได้", "Administrator ใช้ Tailscale / MagicDNS"),
        ("Wi-Fi ต้องลงทะเบียน MAC", "ใช้ permanent MAC และปิด randomization"),
        ("ESP32 2.4 GHz และ Pi เป็น ARM", "ใช้ compatible network และ ARM Docker images"),
    ]

    left_x = MARGIN
    right_x = PAGE_W / 2 + 16
    col_w = PAGE_W / 2 - MARGIN - 32
    c.setFont("TahomaBold", 12)
    c.setFillColor(BLUE)
    c.drawString(left_x, 441, "CONSTRAINT")
    c.setFillColor(GREEN)
    c.drawString(right_x, 441, "DESIGN RESPONSE")

    y = 398
    for idx, (constraint, response) in enumerate(constraints):
        fill = white if idx % 2 == 0 else LIGHT
        c.setFillColor(fill)
        c.rect(MARGIN, y - 38, PAGE_W - 2 * MARGIN, 42, fill=1, stroke=0)
        c.setFillColor(AMBER)
        c.circle(left_x + 6, y - 17, 3.2, fill=1, stroke=0)
        paragraph(c, constraint, left_x + 18, y - 7, col_w - 18, 40,
                  size=12.5, font="TahomaBold", leading=16)
        c.setStrokeColor(RULE)
        c.line(PAGE_W / 2, y - 36, PAGE_W / 2, y + 1)
        paragraph(c, response, right_x, y - 7, col_w, 40,
                  size=12.5, color=INK, leading=16)
        y -= 44

    c.setFillColor(NAVY)
    c.roundRect(MARGIN, 52, PAGE_W - 2 * MARGIN, 62, 10, fill=1, stroke=0)
    paragraph(c,
              "<b>Functional = What</b>  •  <b>NFR = How well</b>  •  <b>Constraints = Design boundaries</b><br/>ทั้งหมดนี้นำไปกำหนด Definition of Done ในข้อ 2.4",
              MARGIN + 22, 104, PAGE_W - 2 * MARGIN - 44, 46,
              size=13.5, color=white, leading=17, alignment=1)
    footer(c, 5)


def build():
    c = canvas.Canvas(str(OUTPUT), pagesize=(PAGE_W, PAGE_H))
    c.setTitle("SE-IoT Section 2.3 Product Backlog")
    c.setAuthor("SE-IoT Team")
    for slide_fn in (slide_1, slide_2, slide_3, slide_4, slide_5):
        c.setFillColor(white)
        c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        slide_fn(c)
        c.showPage()
    c.save()
    print(OUTPUT)


if __name__ == "__main__":
    build()
