image-embeded:
	cp -r ../grist ../requirements.txt .  # docker build requires files to be present.
	docker build -t grist-docker-sandbox .
	rm -rf grist requirements.txt

image:
	cp ../requirements.txt .  # docker build requires files to be present.
	docker build -t grist-docker-sandbox .
	rm requirements.txt
