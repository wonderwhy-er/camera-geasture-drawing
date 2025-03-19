# Hand Gesture Drawing

A webcam-based drawing application that uses hand gestures for a natural and intuitive drawing experience.

## Live Demo

Try it out: [Hand Gesture Drawing Live Demo](https://wonderwhy-er.github.io/camera-geasture-drawing/)

> **Note**: You'll need to grant camera permissions to use the application.

## Overview

This application allows you to draw on your screen using hand gestures captured through your webcam. It uses MediaPipe Hands for real-time hand tracking and gesture recognition.

## Features

- **Full-screen webcam interface**: See yourself as you draw
- **Intuitive gesture controls**:
  - Point with your index finger to draw
  - Open your palm to erase
- **Dynamic brush sizing**: The brush and eraser size automatically adjusts based on your hand's distance from the camera:
  - Move your hand closer for larger strokes
  - Move your hand further away for finer details
- **Color selection**: Choose any color for your drawing
- **Save functionality**: Save your artwork as a PNG image

## How It Works

The application uses MediaPipe Hands to detect and track hand landmarks in real-time. It recognizes specific hand gestures to trigger different actions:

- **Drawing Mode**: When you point with just your index finger, it tracks the tip and draws along its path
- **Erasing Mode**: When you open your palm, it creates an eraser sized proportionally to your palm

The brush and eraser sizes dynamically scale based on the apparent size of your hand in the frame, creating a natural drawing experience where proximity to the camera directly affects stroke size.

## Technologies Used

- HTML5 Canvas for drawing
- MediaPipe Hands for hand tracking and gesture recognition
- JavaScript for application logic
- CSS for styling

## Creation Context

This project was created during a YouTube video with the assistance of Claude AI. It demonstrates how AI can help create interactive web applications that utilize computer vision and gesture recognition technologies.

## License

This project is licensed under the terms of the license included in the repository.
