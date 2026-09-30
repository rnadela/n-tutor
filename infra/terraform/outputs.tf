output "droplet_ip" {
  description = "Public IP of the ntutor Droplet"
  value       = digitalocean_droplet.app.ipv4_address
}
