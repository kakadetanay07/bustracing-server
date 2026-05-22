"""
SmartBus Tracking — Python Flask Backend
=========================================
Features:
  • Speed history buffer        → GET /api/speed-history
  • Live analytics stats        → GET /api/stats
  • Overspeed & breakdown alerts→ GET /api/alerts
  • PDF report generation       → GET /api/report
  • Receive bus data from JS    → POST /api/update

Install dependencies (run once):
  pip install flask firebase-admin fpdf2

If you have a Firebase service account key (recommended):
  1. Firebase Console → Project Settings → Service Accounts → Generate new private key
  2. Save as  serviceAccountKey.json  in the same folder as this file
  3. Uncomment the firebase-admin block below

Run:
  python server.py
  (keep this terminal open while using the web dashboard)
"""

import json, math, io, threading, time
from datetime import datetime
from collections import deque
from flask import Flask, jsonify, request, send_file, Response

app = Flask(__name__)

# ── CORS (allow the HTML file opened from disk or localhost) ──────────────────
ALLOWED_ORIGINS = {
    "https://bustracingfullandfinal.netlify.app/",
    "https://bustracing-server.onrender.com",
    "null",
}

@app.after_request
def add_cors(response):
    origin = request.headers.get("Origin", "")
    # Allow if it's one of our known origins, or any localhost port
    if (origin in ALLOWED_ORIGINS
            or origin.startswith("http://localhost:")
            or origin.startswith("http://127.0.0.1:")):
        response.headers["Access-Control-Allow-Origin"]  = origin
    else:
        response.headers["Access-Control-Allow-Origin"]  = "https://bustracingfullandfinal.netlify.app/"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response

@app.route("/api/<path:p>", methods=["OPTIONS"])
def preflight(p):
    return Response(status=204)

# ── In-memory state ───────────────────────────────────────────────────────────
speed_history  = deque(maxlen=60)   # last 60 readings  {time, speed}
alerts         = deque(maxlen=50)   # alert log
trail_points   = deque(maxlen=200)  # GPS trail  [lat, lng]

stats = {
    "maxSpeed":      0.0,
    "totalDistance": 0.0,
    "alertCount":    0,
    "tripStart":     datetime.now().strftime("%H:%M:%S"),
}

_prev_lat = None
_prev_lng = None
_lock     = threading.Lock()

# ── Haversine distance (km) ───────────────────────────────────────────────────
def haversine(lat1, lng1, lat2, lng2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2))
         * math.sin(dlng / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))

# ── Process incoming bus data ─────────────────────────────────────────────────
def process_update(data: dict):
    global _prev_lat, _prev_lng

    lat   = float(data.get("latitude",  0))
    lng   = float(data.get("longitude", 0))
    speed = float(data.get("speed",     0))
    now   = datetime.now().strftime("%H:%M:%S")

    with _lock:
        # Speed history
        speed_history.append({"time": now, "speed": round(speed, 1)})

        # Trail
        trail_points.append([lat, lng])

        # Max speed
        if speed > stats["maxSpeed"]:
            stats["maxSpeed"] = round(speed, 1)

        # Distance
        if _prev_lat is not None:
            dist = haversine(_prev_lat, _prev_lng, lat, lng)
            stats["totalDistance"] = round(stats["totalDistance"] + dist, 3)

        _prev_lat, _prev_lng = lat, lng

        # Overspeed alert (threshold: 60 km/h)
        if speed > 60:
            alerts.append({
                "type":    "overspeed",
                "message": f"Overspeed: {speed:.1f} km/h",
                "time":    now,
            })
            stats["alertCount"] += 1

        # Proximity / terminal stop alert sent by JS
        alert_type = data.get("alert", "")
        if alert_type.startswith("approaching_"):
            stop_name  = alert_type.replace("approaching_", "").replace("_", " ")
            dist_m     = data.get("distanceM", 0)
            alerts.append({
                "type":    "proximity",
                "message": f"Bus approaching {stop_name} ({dist_m} m away)",
                "time":    now,
            })
            stats["alertCount"] += 1

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/api/update", methods=["POST"])
def api_update():
    """Frontend JS pushes each Firebase snapshot here."""
    data = request.get_json(silent=True) or {}
    process_update(data)
    return jsonify({"ok": True})


@app.route("/api/speed-history")
def api_speed_history():
    with _lock:
        return jsonify(list(speed_history))


@app.route("/api/stats")
def api_stats():
    with _lock:
        avg = (sum(r["speed"] for r in speed_history) / len(speed_history)
               if speed_history else 0)
        return jsonify({
            "avgSpeed":      round(avg, 1),
            "maxSpeed":      stats["maxSpeed"],
            "totalDistance": stats["totalDistance"],
            "alertCount":    stats["alertCount"],
            "tripStart":     stats["tripStart"],
        })


@app.route("/api/alerts")
def api_alerts():
    with _lock:
        return jsonify(list(alerts)[-15:])


@app.route("/api/trail")
def api_trail():
    with _lock:
        return jsonify(list(trail_points))


@app.route("/api/report")
def api_report():
    """Generate and stream a plain-text report (PDF if fpdf2 is installed)."""
    with _lock:
        snap_hist   = list(speed_history)
        snap_alerts = list(alerts)
        snap_stats  = dict(stats)

    avg = (sum(r["speed"] for r in snap_hist) / len(snap_hist)
           if snap_hist else 0)

    # ── Try PDF (fpdf2) ───────────────────────────────────────────────────────
    try:
        from fpdf import FPDF

        class PDF(FPDF):
            def header(self):
                self.set_fill_color(7, 12, 24)
                self.rect(0, 0, 210, 297, "F")
                self.set_text_color(0, 200, 255)
                self.set_font("Helvetica", "B", 22)
                self.cell(0, 14, "SmartBus Tracking Report", ln=True, align="C")
                self.set_text_color(78, 94, 122)
                self.set_font("Helvetica", "", 10)
                self.cell(0, 7,
                          f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                          ln=True, align="C")
                self.ln(6)

        pdf = PDF()
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.add_page()
        pdf.set_text_color(240, 244, 255)

        # Summary section
        pdf.set_font("Helvetica", "B", 13)
        pdf.set_text_color(0, 200, 255)
        pdf.cell(0, 10, "Summary Statistics", ln=True)
        pdf.set_text_color(240, 244, 255)
        pdf.set_font("Helvetica", "", 11)
        rows = [
            ("Trip Start",       snap_stats["tripStart"]),
            ("Average Speed",    f"{avg:.1f} km/h"),
            ("Max Speed",        f"{snap_stats['maxSpeed']} km/h"),
            ("Total Distance",   f"{snap_stats['totalDistance']} km"),
            ("Alerts Triggered", str(snap_stats["alertCount"])),
            ("Speed Readings",   str(len(snap_hist))),
        ]
        for label, value in rows:
            pdf.set_font("Helvetica", "B", 10)
            pdf.set_text_color(136, 149, 176)
            pdf.cell(55, 8, label + ":", ln=False)
            pdf.set_font("Helvetica", "", 10)
            pdf.set_text_color(240, 244, 255)
            pdf.cell(0, 8, value, ln=True)

        pdf.ln(5)

        # Speed history table (last 20)
        if snap_hist:
            pdf.set_font("Helvetica", "B", 13)
            pdf.set_text_color(0, 200, 255)
            pdf.cell(0, 10, "Recent Speed Readings (last 20)", ln=True)
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(136, 149, 176)
            pdf.cell(50, 7, "Time", border="B", ln=False)
            pdf.cell(0,  7, "Speed (km/h)", border="B", ln=True)
            pdf.set_font("Helvetica", "", 9)
            for row in snap_hist[-20:]:
                pdf.set_text_color(240, 244, 255)
                pdf.cell(50, 6, row["time"], ln=False)
                color = (255, 60, 90) if row["speed"] > 60 else (0, 229, 122)
                pdf.set_text_color(*color)
                pdf.cell(0, 6, str(row["speed"]), ln=True)

        pdf.ln(5)

        # Alerts
        if snap_alerts:
            pdf.set_font("Helvetica", "B", 13)
            pdf.set_text_color(0, 200, 255)
            pdf.cell(0, 10, "Alert Log", ln=True)
            pdf.set_font("Helvetica", "", 9)
            for a in snap_alerts:
                pdf.set_text_color(255, 60, 90)
                pdf.cell(0, 6, f"[{a['time']}]  {a['message']}", ln=True)

        buf = io.BytesIO()
        pdf.output(buf)
        buf.seek(0)
        filename = f"bus_report_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
        return send_file(buf, mimetype="application/pdf",
                         download_name=filename, as_attachment=True)

    except ImportError:
        pass

    # ── Fallback: plain-text report ───────────────────────────────────────────
    lines = [
        "=" * 50,
        "   SmartBus Tracking Report",
        f"   {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "=" * 50,
        "",
        "SUMMARY",
        f"  Trip Start     : {snap_stats['tripStart']}",
        f"  Average Speed  : {avg:.1f} km/h",
        f"  Max Speed      : {snap_stats['maxSpeed']} km/h",
        f"  Total Distance : {snap_stats['totalDistance']} km",
        f"  Alerts         : {snap_stats['alertCount']}",
        "",
        "RECENT SPEED READINGS",
    ]
    for r in snap_hist[-20:]:
        flag = "  *** OVERSPEED ***" if r["speed"] > 60 else ""
        lines.append(f"  {r['time']}  →  {r['speed']} km/h{flag}")

    if snap_alerts:
        lines += ["", "ALERTS"]
        for a in snap_alerts:
            lines.append(f"  [{a['time']}]  {a['message']}")

    lines += ["", "=" * 50]
    report_text = "\n".join(lines)
    buf = io.BytesIO(report_text.encode())
    filename = f"bus_report_{datetime.now().strftime('%Y%m%d_%H%M')}.txt"
    return send_file(buf, mimetype="text/plain",
                     download_name=filename, as_attachment=True)


# ── Optional: Firebase Admin listener (uncomment if you have serviceAccountKey.json) ──
#
# import firebase_admin
# from firebase_admin import credentials, db as fb_db
#
# cred = credentials.Certificate("serviceAccountKey.json")
# firebase_admin.initialize_app(cred, {
#     "databaseURL": "https://eedp-31e22-default-rtdb.asia-southeast1.firebasedatabase.app"
# })
#
# def _fb_listener():
#     ref = fb_db.reference("buses/bus1")
#     def on_value(event):
#         if event.data:
#             process_update(event.data)
#     ref.listen(on_value)
#
# threading.Thread(target=_fb_listener, daemon=True).start()

# ─────────────────────────────────────────────────────────────────────────────
import os
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)