# Raspberry Pi 3 `tempse` — Network Troubleshooting Notes

**Date:** 2026-08-12
**Device:** Raspberry Pi 3, hostname `tempse`, user `ovite`, Ubuntu Server (NetworkManager + netplan)

---

## TL;DR

The Pi was never broken. `@JumboPlus` and `@JumboPlusIoT` are **separate routed subnets**, and mDNS (`.local`) cannot cross a router. The discovery method — `ping tempse.local` → read IP → SSH — works on a flat home LAN but structurally cannot work across those two carrier networks.

Fixed by installing Tailscale, which provides a stable address independent of subnet.

---

## Hardware facts

| Item | Value |
|---|---|
| `wlan0` MAC (registered with IoT network) | `b8:27:eb:73:7d:3e` |
| `eth0` MAC (different — do not register this one) | `b8:27:eb:26:28:6b` |
| IoT subnet | `10.82.36.0/22`, gateway `10.82.36.1` |
| Tailscale IP | `100.101.149.29` |

Pi 3 Wi-Fi is 2.4 GHz only. `@JumboPlusIoT` runs on channel 11, so it is reachable.

---

## Root cause

Ping from the Mac on `@JumboPlus` to the Pi on `@JumboPlusIoT`:

```
ping tempse.local   → cannot resolve tempse.local: Unknown host
ping 10.82.36.74    → 64 bytes ... ttl=63 time=12.196 ms
```

Default TTL is 64. Receiving **63** means the packet crossed exactly **one router**. So:

- The two SSIDs are separate broadcast domains with routing between them.
- **Unicast works fine** — normal traffic routes between the subnets without trouble.
- **mDNS does not** — it uses multicast `224.0.0.251` with TTL 1, which routers never forward. This is by design, not a policy or a fault.
- There is **no client isolation** on this network.

Consequence: `tempse.local` could never resolve from `@JumboPlus`, no matter how healthy the Pi was. With the IP known, SSH would have worked immediately.

### Second, self-inflicted failure

Misreading the first symptom as a broken Wi-Fi card led to re-flashing `/boot/firmware/network-config` with only the home network `MP`. That **erased the IoT credentials**, so the next attempt genuinely could not join — a real failure caused by the fix for an imaginary one.

Two failures with different causes, which is why it appeared inexplicable:

| When | Pi state | Actual cause |
|---|---|---|
| June | Healthy, online | Discovery method couldn't cross a router |
| August | Genuinely offline | IoT credentials deleted by the June "fix" |

---

## Candidates eliminated (with evidence)

| Candidate | Disproved by |
|---|---|
| Broken Wi-Fi card | Worked on `MP` |
| MAC randomization | `ip link show wlan0` showed the permanent hardware MAC |
| Wrong interface registered | `wlan0` was the one registered — correct |
| Wrong hostname | `hostname: tempse` set at flash time in `user-data` |
| Missing avahi | `avahi-daemon` present in cloud-init packages |
| Wrong SSID / captive portal | Flashed `@JumboPlusIoT`, not the portal network; `captive-check:204` |
| YAML `@` parse failure | Imager quotes SSIDs (`"MP"` in the file confirms) |
| Client isolation | `ping 10.82.36.74` from `@JumboPlus` succeeds |

---

## Config system — important quirk

This Ubuntu image runs **NetworkManager with the netplan backend**. NM writes its own connections into `/etc/netplan/90-NM-<uuid>.yaml`.

- **Use `nmcli`.** Changes persist; NM writes them to disk itself.
- **Do not hand-edit** the `90-NM-*.yaml` files — NM owns and rewrites them.
- Properties netplan can't express (e.g. `cloned-mac-address permanent`) fall back to `/etc/NetworkManager/system-connections/*.nmconnection`, which is equally durable.

---

## Current configuration

Wi-Fi profiles with autoconnect priorities — prefers IoT, falls back to home:

```bash
sudo nmcli connection modify "IOT-TEST" connection.autoconnect yes connection.autoconnect-priority 20
sudo nmcli connection modify "netplan-wlan0-MP" connection.autoconnect yes connection.autoconnect-priority 10
```

MAC pinned so a NetworkManager update can't re-enable randomization and silently break the MAC registration — `/etc/NetworkManager/conf.d/99-no-random-mac.conf`:

```ini
[device]
wifi.scan-rand-mac-address=no

[connection]
wifi.cloned-mac-address=permanent
```

Three independent ways in: **Tailscale**, **Raspberry Pi Connect** (enrolled by the original cloud-init), and **direct IP** from any routed network.

---

## Safe procedure for network changes over SSH

Reconfiguring the interface you are connected through will drop the session. Two protections:

```bash
# survives the SSH session dying
sudo systemd-run --unit=wifi-switch --collect nmcli connection up "IOT-TEST"

# escape hatch: auto-return to the known-good network in 5 minutes
sudo systemd-run --on-active=300 --unit=net-revert --collect nmcli connection up "netplan-wlan0-MP"

# cancel once access is confirmed
sudo systemctl stop net-revert.timer
```

For netplan changes, `sudo netplan try` auto-reverts after 120 s if not confirmed.

### Self-reverting test script

Connects, records diagnostics, returns to the fallback network unaided. Read the log after reconnecting.

```bash
#!/bin/bash
exec >>/var/log/iot-test.log 2>&1
echo "===== test $(date) ====="
ip link show wlan0 | grep ether
nmcli connection up "IOT-TEST"
sleep 20
nmcli -f GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS,IP4.GATEWAY device show wlan0
ip route
ping -c3 -W3 1.1.1.1
curl -sS -m10 -o /dev/null -w "captive-check:%{http_code}\n" http://connectivitycheck.gstatic.com/generate_204
tailscale status
echo "===== revert ====="
nmcli connection up "netplan-wlan0-MP"
```

Reading the results:

- `4-Way Handshake failed` → wrong password
- Associates then deauthenticates → MAC rejected / registration inactive
- `169.254.x.x` or no IP → associated but DHCP refused (quarantine)
- Real IP, ping fails → connected but filtered
- `captive-check:200` instead of `204` → captive portal requiring browser login

---

## Finding the Pi's IP without mDNS

1. **Tailscale MagicDNS** *(best)* — enable in admin console, then `ssh ovite@tempse` from anywhere.
2. **Raspberry Pi Connect** — browser shell, no IP needed.
3. **Scan the subnet** — unicast routes across, so this works from another subnet:
   ```
   nmap -p22 --open 10.82.36.0/22
   ```
4. **Serial console** — `rpi: interfaces: serial: true` is already enabled in `user-data`. A USB-TTL adapter on the GPIO pins gives a login prompt with no network at all.
5. **Self-announce on boot** — a `systemd` oneshot that POSTs `hostname -I` to an ntfy.sh topic after `network-online.target`.

Note: `10.82.36.74` is a DHCP lease (~24 h). Don't hardcode it.

---

## Outstanding tasks

- [x] Enable **MagicDNS** in Tailscale — done; confirmed `tempse.tail2afb95.ts.net` resolves (2026-08-17)
- [ ] **Disable Tailscale key expiry** for `tempse` — the 180-day default would strand the device
- [ ] **Rotate the Raspberry Pi Connect auth key** — it was exposed in a chat transcript
- [ ] **Change the account password** (`passwd`) — the hash was exposed in the same transcript
- [ ] Rotate Wi-Fi PSKs if the networks permit

---

## Lessons

**`.local` works only within one network segment.** Once a device may move networks, use something that doesn't depend on the LAN.

**Establish an out-of-band path before reconfiguring the network you're connected through.** Set up Tailscale first, then experiment freely.

**Make risky network changes self-reverting.** `systemd-run --collect` survives a dropped session; `--on-active` arms a rollback; `netplan try` does the same for netplan.

**A failed lookup is not a failed device.** The June reset destroyed working configuration — and the evidence needed to diagnose it. Confirm what is actually broken before changing it.

---

# Session 2026-08-17

## "Can't connect again" — cause: Tailscale stopped on the Mac

Not the Pi. `tailscale status` on the Mac returned `Tailscale is stopped.` Starting it restored access immediately.

```
tailscale status    → Tailscale is stopped.
ping 10.82.36.74    → 100% loss      (stale June lease)
ping tempse.local   → cannot resolve  (mDNS, still can't cross the router)
ping 100.101.149.29 → 100% loss      (local Tailscale down)
```

Restart with `tailscale up --timeout=25s --accept-routes` — plain `tailscale up` errors because it requires re-stating all non-default flags.

Pi side was never at fault: `systemctl is-enabled tailscaled` → `enabled`, `is-active` → `active`, uptime 23 min. It had booted that morning and rejoined the tailnet unattended.

**Fix so it doesn't recur:** enable "Run Tailscale at login" in the Mac menu-bar app. The Mac is the single point of failure, not the Pi.

## Static IP attempt — FAILED, do not retry

Goal was a fixed address so clients need no Tailscale. `10.82.39.200/22` was probed free from the Pi first. Applied with the self-reverting pattern from above.

Result: **total loss of connectivity** — direct IP *and* Tailscale both dropped. The network almost certainly enforces DHCP and drops self-assigned addresses; with no routable path, Tailscale couldn't reach its coordination servers either.

The `--on-active=300` revert timer fired and restored DHCP cleanly (~120 s, since the timer counted from when it was armed, not from the IP change). Verified afterwards: `ipv4.method:auto`, `ipv4.addresses` empty, both units inactive, and the **same** lease `10.82.36.98` handed back.

Two things this confirms:

- Static addressing on `@JumboPlusIoT` is a dead end. DHCP reservation would need carrier-router admin access.
- The self-reverting procedure works exactly as designed. It turned an unrecoverable mistake into a 2-minute wait.

## Access matrix (verified 2026-08-17)

Current lease: `10.82.36.98` (was `.74` in June — it does drift across long power-offs, but survives short drops).

| From | Command | Needs | RTT | Fails when |
|---|---|---|---|---|
| ESP32 on `@JumboPlusIoT` | `tempse.local` | avahi (active) | — | never — same subnet |
| Laptop on `@JumboPlus` | `ssh ovite@tempse` | Tailscale running | 104 ms (relayed) | key expiry, app not running |
| Laptop on `@JumboPlus` | `ssh ovite@10.82.36.98` | nothing | 10 ms | lease drifts |
| Laptop on `@JumboPlus` | `ssh ovite@tempse.local` | — | — | always — mDNS can't cross the router |

**Key point:** mDNS fails only *across* the router. Devices on the IoT subnet resolve `tempse.local` normally. So ESP32 sensors should target `tempse.local:1883`, never a hardcoded IP — the lease can drift without breaking them.

SSH posture is key-only and safe to expose on a shared network: `passwordauthentication no`, `kbdinteractiveauthentication no`, `pubkeyauthentication yes`. No fail2ban installed.

## MQTT broker — already running

Host is **Debian 13 (trixie) aarch64**, 905 MB RAM, 29 G SD (26% used). Docker Compose project at `/home/ovite/SE-Iot`:

| Container | Image | Ports |
|---|---|---|
| `se-iot-mqtt` | `eclipse-mosquitto:2` | `0.0.0.0:1883→1883` |
| `se-iot-backend` | `se-iot-backend` | `0.0.0.0:5001→5000` |
| `se-iot-frontend` | `se-iot-frontend` | `0.0.0.0:5174→80` |

Current `mosquitto.conf` — **insecure**:

```
listener 1883
allow_anonymous true
persistence false
```

`allow_anonymous true` on a carrier network with routing from `@JumboPlus` means any device on either subnet can read every sensor reading and publish forged ones into the topics. `persistence false` means a reboot drops retained messages and queued QoS 1 traffic.

### Broker tasks, in order

1. **Authentication** — password file, one credential per ESP32, set `allow_anonymous false`.
2. **Persistence** — enable it and mount a volume.
3. **Topic tree** — settle it before deployment; renaming later means re-flashing every device. Suggested `sensors/<place>/<device>/<metric>`.
4. **ACLs** — each device publishes only to its own topic, reads nothing else.
5. **Verify storage** — MQTT retains nothing. Confirm `se-iot-backend` actually persists readings, and set a retention policy.
6. **SD card wear** — high-frequency small writes destroy microSD. Batch writes or move the database off-device.

## Lessons added

**Check your own end first.** Two "the Pi is broken" incidents now, neither caused by the Pi. June was the discovery method; August was the Mac's Tailscale client.

**A self-reverting change turns a fatal mistake into a wait.** The static IP attempt killed every path into the device simultaneously. Without the armed timer it would have needed a serial console.

**mDNS is not useless — it is segment-scoped.** The right question is never "does `.local` work" but "is this client on the same segment". ESP32s are; the laptop isn't.
